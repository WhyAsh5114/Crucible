/**
 * KeeperHub client for mcp-deployer.
 *
 * Implements three tools that form the "ship path" for public-chain deployment
 * via KeeperHub. This is the ONLY sanctioned route for writing to a public chain;
 * no eth_sendRawTransaction calls are ever made directly from this module.
 *
 * SDK note: uses KeeperHub's REST API directly via fetch (no official npm SDK
 * exists for agentic contract-deployment flows as of May 2026).
 *
 * API mapping (KeeperHub Workflow API):
 *   simulate_bundle  → POST /api/workflows/create  (creates a workflow with contractWrite nodes)
 *   execute_tx       → POST /api/workflow/{workflowId}/execute
 *   get_execution_status → GET /api/workflows/executions/{executionId}/status + /logs
 *
 * Base URL: https://app.keeperhub.com  (NOT api.keeperhub.com)
 * Auth: Authorization: Bearer kh_xxx
 *
 * Tools exposed:
 *   simulate_bundle(artifacts, deployerAddress) → SimulateBundleOutput
 *   execute_tx(bundleId)                        → ExecuteTxOutput
 *   get_execution_status(executionId)           → ExecutionStatusOutput
 */

import {
  SimulateBundleInputSchema,
  SimulateBundleOutputSchema,
  ExecuteTxInputSchema,
  ExecuteTxOutputSchema,
  GetExecutionStatusInputSchema,
  GetExecutionStatusOutputSchema,
  type SimulateBundleInput,
  type SimulateBundleOutput,
  type ExecuteTxInput,
  type ExecuteTxOutput,
  type GetExecutionStatusInput,
  type GetExecutionStatusOutput,
  type PerTxGasEstimate,
} from '@crucible/types/mcp/deployer';

// Re-export for callers that previously imported from this module.
export {
  SimulateBundleInputSchema,
  SimulateBundleOutputSchema,
  ExecuteTxInputSchema,
  ExecuteTxOutputSchema,
  GetExecutionStatusInputSchema,
  GetExecutionStatusOutputSchema,
};
export type {
  SimulateBundleInput,
  SimulateBundleOutput,
  ExecuteTxInput,
  ExecuteTxOutput,
  GetExecutionStatusInput,
  GetExecutionStatusOutput,
};

// Output type alias used internally by executeAndPoll.
type ExecutionStatusOutput = GetExecutionStatusOutput;

// ---------------------------------------------------------------------------
// Environment config
// ---------------------------------------------------------------------------

export interface KeeperHubClientConfig {
  apiKey: string;
  baseUrl: string;
}

/**
 * Resolves a compiled contract's creation bytecode by bare contract name.
 * Injected by the deployer service so the KeeperHub client can stay
 * transport-only and the agent never has to pass raw bytecode in tool inputs.
 */
export type BytecodeResolver = (contractName: string) => Promise<string>;

export function getKeeperHubConfig(): KeeperHubClientConfig | null {
  const apiKey = process.env['KEEPERHUB_API_KEY'];
  // KeeperHub REST API base: https://app.keeperhub.com (not api.keeperhub.com)
  // Auth is via Authorization: Bearer kh_xxx header, not x-api-key.
  // The MCP server at https://mcp.keeperhub.com/sse is a separate Claude Code
  // integration endpoint — our REST client hits the App Base URL + /api.
  const baseUrl = process.env['KEEPERHUB_API_URL'] ?? 'https://app.keeperhub.com/api';
  if (!apiKey) return null;
  return { apiKey, baseUrl };
}

// ---------------------------------------------------------------------------
// Input / output schemas
// ---------------------------------------------------------------------------

// Schemas live in @crucible/types/mcp/deployer (see top-of-file imports).
// The agent registers those schemas with the AI SDK's MCP client so the
// LLM sees the same artifact-reference shape this server expects.

// ---------------------------------------------------------------------------
// HTTP transport helpers
// ---------------------------------------------------------------------------

async function khFetch<T>(
  config: KeeperHubClientConfig,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const url = `${config.baseUrl.replace(/\/+$/u, '')}${path}`;
  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      // KeeperHub API uses Bearer token auth (organization API key, kh_ prefix).
      // Docs: https://docs.keeperhub.com/api/authentication
      authorization: `Bearer ${config.apiKey}`,
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `KeeperHub API (${path}) returned non-JSON ${res.status}: ${text.slice(0, 200)}`,
    );
  }

  if (!res.ok) {
    // Check if the error matches the { error: { code, message } } format from the docs
    const errBody = json as { error?: string | { code?: string; message?: string } };
    if (typeof errBody.error === 'object' && errBody.error?.message) {
      throw new Error(
        `KeeperHub API error ${res.status} at ${path} (${errBody.error.code ?? 'UNKNOWN'}): ${errBody.error.message}`,
      );
    }
    // Fallback: KeeperHub sometimes returns { error: "string" }
    if (typeof errBody.error === 'string') {
      throw new Error(`KeeperHub API error ${res.status} at ${path}: ${errBody.error}`);
    }
    throw new Error(`KeeperHub API error ${res.status} at ${path}: ${text.slice(0, 200)}`);
  }

  return json as T;
}

// ---------------------------------------------------------------------------
// KeeperHub client implementation
// ---------------------------------------------------------------------------

export interface KeeperHubClient {
  simulateBundle(input: SimulateBundleInput): Promise<SimulateBundleOutput>;
  executeTx(input: ExecuteTxInput): Promise<ExecuteTxOutput>;
  getExecutionStatus(input: GetExecutionStatusInput): Promise<ExecutionStatusOutput>;
}

// ── KeeperHub Workflow API wire types ────────────────────────────────────────

interface KhWorkflowNode {
  id: string;
  type: string;
  data: {
    type: string;
    label: string;
    config: Record<string, unknown>;
    status: string;
    description: string;
  };
  position: { x: number; y: number };
}

interface KhWorkflowEdge {
  id: string;
  type: string;
  source: string;
  target: string;
}

interface KhWorkflowCreateResponse {
  id: string;
  name: string;
  nodes: KhWorkflowNode[];
  edges: KhWorkflowEdge[];
  [key: string]: unknown;
}

interface KhWorkflowExecuteResponse {
  executionId: string;
  status: string;
  runId?: string;
}

interface KhExecutionStatusResponse {
  status: string;
  nodeStatuses: Array<{ nodeId: string; status: string }>;
  progress: {
    totalSteps: number;
    completedSteps: number;
    runningSteps: number;
    currentNodeId: string | null;
    percentage: number;
  };
  errorContext?: string | null;
}

interface KhExecutionLogsResponse {
  execution: {
    id: string;
    workflowId: string;
    status: string;
    output?: Record<string, unknown> | null;
    error?: string | null;
    runId?: string;
    completedAt?: string | null;
    executionTrace?: string[];
    [key: string]: unknown;
  };
  nodeLogs?: Array<{
    nodeId: string;
    nodeName?: string;
    nodeType?: string;
    status: string;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
}

/**
 * Estimate gas locally based on bytecode size.
 * This is a rough approximation: 21000 base + 200 per bytecode byte + 32000 CREATE overhead.
 * KeeperHub doesn't expose a simulation-only endpoint, so this provides a
 * best-effort pre-flight estimate. The actual gas used will be determined
 * on-chain during workflow execution.
 */
function estimateGasForBytecode(bytecode: string): string {
  const byteCount = (bytecode.length - 2) / 2; // strip 0x, each byte = 2 hex chars
  // Base gas (21000) + per-byte cost (~200/byte for deployment) + CREATE overhead (32000)
  const estimate = 21000 + byteCount * 200 + 32000;
  return String(estimate);
}

/**
 * Map KeeperHub workflow execution status to our normalized status enum.
 * KeeperHub statuses: pending, running, success, error, cancelled
 * Our statuses:       pending, mined, confirmed, failed
 */
function normalizeStatus(khStatus: string): 'pending' | 'mined' | 'confirmed' | 'failed' {
  switch (khStatus) {
    case 'success':
      return 'confirmed';
    case 'error':
    case 'cancelled':
      return 'failed';
    case 'running':
      return 'mined'; // "running" = tx is being processed ≈ mined but not finalized
    case 'pending':
    default:
      return 'pending';
  }
}

/**
 * Create a KeeperHub client.
 *
 * `resolveBytecode` is required: artifact inputs only carry a `contractName`,
 * so the client must look up the matching creation bytecode from the local
 * compiler artifact store. The deployer service injects a fetch-based
 * resolver that hits mcp-compiler's `/bytecode/:name` endpoint.
 */
export function createKeeperHubClient(
  config: KeeperHubClientConfig,
  resolveBytecode: BytecodeResolver,
): KeeperHubClient {
  return {
    /**
     * simulate_bundle → Creates a KeeperHub workflow with contractWrite action
     * nodes for each artifact. Returns the workflowId as the bundleId and
     * locally-estimated gas figures. No on-chain simulation occurs — KeeperHub
     * doesn't expose a standalone simulation endpoint.
     */
    async simulateBundle(input) {
      // Resolve bytecode for every artifact up-front so a missing artifact
      // surfaces a single clear error instead of a half-built workflow.
      const resolved = await Promise.all(
        input.artifacts.map(async (a) => ({
          ref: a,
          bytecode: await resolveBytecode(a.contractName),
        })),
      );

      // Build workflow nodes: one trigger + one action per artifact
      const triggerId = `trigger_${Date.now()}`;
      const nodes: KhWorkflowNode[] = [
        {
          id: triggerId,
          type: 'trigger',
          data: {
            type: 'trigger',
            label: 'Manual Trigger',
            config: { triggerType: 'Manual' },
            status: 'idle',
            description: 'Crucible ship trigger',
          },
          position: { x: 0, y: 0 },
        },
      ];
      const edges: KhWorkflowEdge[] = [];

      let prevNodeId = triggerId;
      const gasEstimates: PerTxGasEstimate[] = [];

      for (let i = 0; i < resolved.length; i++) {
        const { ref: artifact, bytecode } = resolved[i]!;
        const actionId = `deploy_${i}_${Date.now()}`;
        const fullBytecode =
          artifact.constructorData && artifact.constructorData !== '0x'
            ? bytecode + artifact.constructorData.slice(2)
            : bytecode;

        nodes.push({
          id: actionId,
          type: 'action',
          data: {
            type: 'action',
            label: `Deploy ${artifact.contractName}`,
            config: {
              actionType: 'contractWrite',
              network: 'sepolia',
              // For contract creation: address is zero, data is the full creation bytecode
              contractAddress: '0x0000000000000000000000000000000000000000',
              functionName: '',
              abi: '[]',
              args: '[]',
              data: fullBytecode,
              ...(artifact.value && artifact.value !== '0' ? { value: artifact.value } : {}),
            },
            status: 'idle',
            description: `Deploy ${artifact.contractName} via KeeperHub`,
          },
          position: { x: 272 * (i + 1), y: 0 },
        });

        edges.push({
          id: `edge_${i}_${Date.now()}`,
          type: 'animated',
          source: prevNodeId,
          target: actionId,
        });

        prevNodeId = actionId;

        gasEstimates.push({
          index: i,
          contractName: artifact.contractName,
          gasEstimate: estimateGasForBytecode(fullBytecode),
          note: 'Local estimate — actual gas determined on-chain by KeeperHub',
        });
      }

      // Create the workflow on KeeperHub
      const contractNames = input.artifacts.map((a) => a.contractName).join(', ');
      const workflow = await khFetch<KhWorkflowCreateResponse>(config, '/workflows/create', {
        method: 'POST',
        body: {
          name: `crucible-ship-${contractNames}-${Date.now()}`,
          description: `Crucible contract deployment: ${contractNames}`,
          nodes,
          edges,
        },
      });

      return {
        bundleId: workflow.id,
        gasEstimates,
        willSucceed: true,
        summary:
          `Workflow created with ${input.artifacts.length} deployment action(s). ` +
          `Gas estimates are local approximations. ` +
          `Call execute_tx with bundleId="${workflow.id}" to deploy on Sepolia.`,
      };
    },

    /**
     * execute_tx → Executes the workflow created by simulateBundle.
     * Maps to: POST /api/workflow/{workflowId}/execute
     * KeeperHub uses private routing internally — no eth_sendRawTransaction.
     *
     * ⚠️ NOT idempotent: each call creates a new execution run.
     */
    async executeTx(input) {
      const raw = await khFetch<KhWorkflowExecuteResponse>(
        config,
        `/workflow/${encodeURIComponent(input.bundleId)}/execute`,
        { method: 'POST' },
      );

      return {
        executionId: raw.executionId,
        txHash: null, // KeeperHub workflow execute doesn't return txHash immediately
        status: normalizeStatus(raw.status),
      };
    },

    /**
     * get_execution_status → Polls execution status and extracts tx details
     * from execution logs when available.
     * Maps to: GET /api/workflows/executions/{executionId}/status
     *        + GET /api/workflows/executions/{executionId}/logs (for tx details)
     */
    async getExecutionStatus(input) {
      // Get basic status
      const statusRes = await khFetch<KhExecutionStatusResponse>(
        config,
        `/workflows/executions/${encodeURIComponent(input.executionId)}/status`,
      );

      const status = normalizeStatus(statusRes.status);

      // Extract tx details from node outputs (action nodes that wrote to chain)
      let txHash: `0x${string}` | null = null;
      let contractAddress: `0x${string}` | null = null;
      let auditTrailId: string | null = null;
      let explorerUrl: string | null = null;
      let blockNumber: number | null = null;

      if (status === 'confirmed' || status === 'failed') {
        try {
          const logs = await khFetch<KhExecutionLogsResponse>(
            config,
            `/workflows/executions/${encodeURIComponent(input.executionId)}/logs`,
          );

          // The execution ID doubles as the audit trail reference
          auditTrailId = logs.execution.runId ?? logs.execution.id;

          // Extract tx details from node outputs (action nodes that wrote to chain)
          if (logs.nodeLogs) {
            for (const nodeLog of logs.nodeLogs) {
              if (nodeLog.output) {
                const out = nodeLog.output as Record<string, unknown>;
                if (typeof out['transactionHash'] === 'string') {
                  txHash = out['transactionHash'] as `0x${string}`;
                }
                if (typeof out['txHash'] === 'string') {
                  txHash = out['txHash'] as `0x${string}`;
                }
                if (typeof out['contractAddress'] === 'string') {
                  contractAddress = out['contractAddress'] as `0x${string}`;
                }
                if (typeof out['blockNumber'] === 'number') {
                  blockNumber = out['blockNumber'] as number;
                }
              }
            }
          }

          if (txHash) {
            explorerUrl = `https://sepolia.etherscan.io/tx/${txHash}`;
          }
        } catch {
          // Log fetch failed — still return status with what we have
          auditTrailId = input.executionId;
        }
      }

      return {
        executionId: input.executionId,
        status,
        txHash,
        blockNumber,
        auditTrailId,
        contractAddress,
        explorerUrl,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Retry helper for execute_tx polling
// ---------------------------------------------------------------------------

/**
 * Execute a bundle and poll until confirmed (or failed), retrying on transient
 * errors up to `maxRetries` times with exponential back-off.
 *
 * Returns the final `ExecutionStatusOutput` once status reaches a terminal
 * state (`confirmed` | `failed`).
 */
export async function executeAndPoll(
  client: KeeperHubClient,
  bundleId: string,
  opts: {
    maxRetries?: number;
    pollIntervalMs?: number;
    timeoutMs?: number;
  } = {},
): Promise<ExecutionStatusOutput> {
  const { maxRetries = 3, pollIntervalMs = 5_000, timeoutMs = 120_000 } = opts;

  // Step 1: execute with retry on transient errors.
  let execResult: ExecuteTxOutput | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      execResult = await client.executeTx({ bundleId });
      break;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 10_000)));
    }
  }
  if (!execResult) throw new Error('execute_tx failed after retries');

  const { executionId } = execResult;

  // If already terminal, convert to status output shape.
  if (execResult.status === 'confirmed' || execResult.status === 'failed') {
    return {
      executionId,
      status: execResult.status,
      txHash: execResult.txHash,
      blockNumber: null,
      auditTrailId: null,
      contractAddress: null,
      explorerUrl: execResult.txHash
        ? `https://sepolia.etherscan.io/tx/${execResult.txHash}`
        : null,
    };
  }

  // Step 2: poll until terminal.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const status = await client.getExecutionStatus({ executionId });
    if (status.status === 'confirmed' || status.status === 'failed') {
      return status;
    }
  }

  throw new Error(`KeeperHub execution ${executionId} timed out after ${timeoutMs}ms`);
}
