/**
 * POST /api/ship — KeeperHub public-chain deployment endpoint.
 *
 * ship_* AgentEvent shapes emitted by this endpoint (Dev C source of truth):
 *
 *   ship_simulated  {
 *     bundleId: string,
 *     gasEstimates: Array<{ index: number, contractName: string, gasEstimate: string, note?: string }>,
 *     willSucceed: boolean,
 *   }
 *
 *   ship_status  {
 *     executionId: string,
 *     status: 'pending' | 'mined' | 'confirmed',
 *     txHash?: string,
 *     blockNumber?: number,
 *   }
 *
 *   ship_confirmed  {
 *     executionId: string,
 *     contractAddress: string,          // Sepolia address on confirmed deploy
 *     auditTrailId: string,             // non-null on confirmed deployments
 *     explorerUrl: string,
 *     chainId: 11155111,
 *   }
 *
 * Auth: requireSession + workspace ownership check (returns 401/404 otherwise).
 * No raw transaction data from the browser; the server fetches bytecode from
 * mcp-compiler and routes everything through KeeperHub. No eth_sendRawTransaction.
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireSession } from '../lib/auth';
import { createApiErrorBody } from '../lib/api-error';
import { loopbackFetch } from '../lib/loopback-fetch';
import { publishAgentEvent, nextAgentSeq, warmAgentSeq } from '../lib/agent-bus';
import { StreamIdSchema, WorkspaceIdSchema } from '@crucible/types';
import { Prisma } from '../generated/prisma/client';

// ---------------------------------------------------------------------------
// Request / response schemas
// ---------------------------------------------------------------------------

/**
 * Phase 1: simulate only (default).
 * Phase 2: set execute: true to trigger the full ship flow.
 */
const ShipBodySchema = z.object({
  workspaceId: WorkspaceIdSchema,
  /** Contract artifact name (must have been compiled by mcp-compiler). */
  artifactName: z.string().min(1),
  /** EOA address that authorises the bundle (from frontend wallet). */
  deployerAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/u, 'Expected a 0x-prefixed 20-byte hex address'),
  /** When true, proceeds to execute after simulation (Phase 2). */
  execute: z.boolean().optional().default(false),
  /** bundleId from a previous simulate call — skip simulation if supplied. */
  bundleId: z.string().optional(),
  /** Chat session to publish ship events into. Falls back to most-recent session. */
  sessionId: z.string().optional(),
});

const SimulatedResponseSchema = z.object({
  phase: z.literal('simulated'),
  bundleId: z.string(),
  gasEstimates: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      contractName: z.string(),
      gasEstimate: z.string(),
      note: z.string().optional(),
    }),
  ),
  willSucceed: z.boolean(),
});

const ExecutingResponseSchema = z.object({
  phase: z.literal('executing'),
  executionId: z.string(),
  txHash: z.string().nullable(),
  status: z.enum(['pending', 'mined', 'confirmed', 'failed']),
  /** Set on confirmed deployments. */
  contractAddress: z.string().nullable().optional(),
  auditTrailId: z.string().nullable().optional(),
  explorerUrl: z.string().nullable().optional(),
  /** Polling URL for the frontend when status is not yet terminal. */
  pollUrl: z.string().optional(),
});

const ShipResponseSchema = z.union([SimulatedResponseSchema, ExecutingResponseSchema]);

const ApiErrorSchema = z.object({ code: z.string(), message: z.string() });

// ---------------------------------------------------------------------------
// OpenAPI routes
// ---------------------------------------------------------------------------

const shipRoute = createRoute({
  method: 'post',
  path: '/ship',
  request: {
    body: {
      content: { 'application/json': { schema: ShipBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ShipResponseSchema } },
      description: 'Ship result (simulate or execute)',
    },
    400: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Bad request',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    404: { content: { 'application/json': { schema: ApiErrorSchema } }, description: 'Not found' },
    503: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'KeeperHub unavailable',
    },
    500: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Internal error',
    },
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SimulateBundleResult {
  bundleId: string;
  gasEstimates: Array<{ index: number; contractName: string; gasEstimate: string; note?: string }>;
  willSucceed: boolean;
  summary?: string;
}

interface ExecutionStatus {
  executionId: string;
  status: 'pending' | 'mined' | 'confirmed' | 'failed';
  txHash: string | null;
  blockNumber: number | null;
  auditTrailId: string | null;
  contractAddress: string | null;
  explorerUrl: string | null;
}

/**
 * Hit the workspace's mcp-deployer loopback to simulate a bundle through
 * KeeperHub. Returns the parsed response or throws on HTTP/parse error.
 *
 * The deployer resolves bytecode from the compiler artifact store — we only
 * pass the artifact reference (contractName) here.
 */
async function callSimulateBundle(
  deployerPort: number,
  artifactName: string,
  deployerAddress: string,
): Promise<SimulateBundleResult> {
  const res = await loopbackFetch(`http://127.0.0.1:${deployerPort}/simulate_bundle`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      artifacts: [
        {
          contractName: artifactName,
          constructorData: '0x',
        },
      ],
      deployerAddress,
      chainId: 11155111,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 503) {
      throw Object.assign(new Error(`KeeperHub not configured on deployer: ${text}`), {
        isKhUnavailable: true,
      });
    }
    throw new Error(`simulate_bundle failed HTTP ${res.status}: ${text}`);
  }

  return (await res.json()) as SimulateBundleResult;
}

async function callExecuteTx(deployerPort: number, bundleId: string): Promise<ExecutionStatus> {
  const res = await loopbackFetch(`http://127.0.0.1:${deployerPort}/execute_tx`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bundleId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`execute_tx failed HTTP ${res.status}: ${text}`);
  }

  const data = (await res.json()) as { executionId: string; txHash: string | null; status: string };
  return {
    executionId: data.executionId,
    status: (data.status ?? 'pending') as ExecutionStatus['status'],
    txHash: data.txHash ?? null,
    blockNumber: null,
    auditTrailId: null,
    contractAddress: null,
    explorerUrl: data.txHash ? `https://sepolia.etherscan.io/tx/${data.txHash}` : null,
  };
}

async function callGetExecutionStatus(
  deployerPort: number,
  executionId: string,
): Promise<ExecutionStatus> {
  const res = await loopbackFetch(
    `http://127.0.0.1:${deployerPort}/execution_status/${encodeURIComponent(executionId)}`,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`get_execution_status failed HTTP ${res.status}: ${text}`);
  }

  return (await res.json()) as ExecutionStatus;
}

/**
 * (Deprecated helper kept removed; the deployer's KeeperHub client now
 * resolves bytecode by contractName via the in-container compiler.)
 */

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

type ApiVars = { Variables: { userId: string } };

const shipBase = new OpenAPIHono<ApiVars>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        createApiErrorBody('bad_request', result.error.issues[0]?.message ?? 'Validation failed'),
        400,
      );
    }
    return undefined;
  },
});

shipBase.use('*', requireSession);

export const shipApi = shipBase.openapi(shipRoute, async (c) => {
  const {
    workspaceId,
    artifactName,
    deployerAddress,
    execute,
    bundleId,
    sessionId: rawSessionId,
  } = c.req.valid('json');
  const userId = c.get('userId');

  // ── Auth: workspace ownership check ─────────────────────────────────────
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: { runtime: true },
  });

  if (!workspace || workspace.userId !== userId) {
    return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
  }

  const runtime = workspace.runtime;
  if (!runtime || runtime.status !== 'ready') {
    return c.json(createApiErrorBody('runtime_unavailable', 'Workspace runtime not ready'), 503);
  }

  const deployerPort = runtime.deployerPort;

  if (!deployerPort) {
    return c.json(createApiErrorBody('runtime_unavailable', 'Deployer port not available'), 503);
  }

  // Resolve sessionId — use the provided one (validated) or fall back to most-recent / auto-create.
  let sessionId: string;
  if (rawSessionId) {
    const existing = await prisma.chatSession.findUnique({
      where: { id: rawSessionId },
      select: { id: true, workspaceId: true },
    });
    if (!existing || existing.workspaceId !== workspaceId) {
      return c.json(createApiErrorBody('not_found', 'Chat session not found'), 404);
    }
    sessionId = existing.id;
  } else {
    const latest = await prisma.chatSession.findFirst({
      where: { workspaceId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (latest) {
      sessionId = latest.id;
    } else {
      const created = await prisma.chatSession.create({
        data: { workspaceId, title: 'Ship' },
        select: { id: true },
      });
      sessionId = created.id;
    }
  }

  await warmAgentSeq(workspaceId, sessionId);
  const streamId = StreamIdSchema.parse(workspaceId);

  // ── Phase 1: simulate_bundle ─────────────────────────────────────────────
  let activeBundleId = bundleId;
  let simulateResult: SimulateBundleResult | null = null;

  if (!activeBundleId) {
    try {
      simulateResult = await callSimulateBundle(deployerPort, artifactName, deployerAddress);
    } catch (err) {
      const isUnavail = (err as { isKhUnavailable?: boolean }).isKhUnavailable;
      if (isUnavail) {
        return c.json(createApiErrorBody('keeperhub_unavailable', String(err)), 503);
      }
      // 4xx-class errors from the deployer (e.g. "contract not compiled")
      // surface as 400 to the frontend so the user sees an actionable message.
      const msg = err instanceof Error ? err.message : String(err);
      if (/HTTP 4\d\d/u.test(msg) || /not found in artifact store/iu.test(msg)) {
        return c.json(createApiErrorBody('bad_request', msg), 400);
      }
      return c.json(createApiErrorBody('internal', msg), 500);
    }

    activeBundleId = simulateResult.bundleId;

    // Emit ship_simulated agent event
    publishAgentEvent(workspaceId, sessionId, {
      streamId,
      seq: nextAgentSeq(workspaceId, sessionId),
      emittedAt: Date.now(),
      type: 'ship_simulated',
      bundleId: simulateResult.bundleId,
      gasEstimates: simulateResult.gasEstimates,
      willSucceed: simulateResult.willSucceed,
    });
  }

  // Phase 1 only — return simulation result
  if (!execute) {
    return c.json(
      SimulatedResponseSchema.parse({
        phase: 'simulated',
        bundleId: activeBundleId,
        gasEstimates: simulateResult?.gasEstimates ?? [],
        willSucceed: simulateResult?.willSucceed ?? true,
      }),
      200,
    );
  }

  // ── Phase 2: execute_tx ───────────────────────────────────────────────────
  let execStatus: ExecutionStatus;
  try {
    execStatus = await callExecuteTx(deployerPort, activeBundleId);
  } catch (err) {
    return c.json(createApiErrorBody('internal', String(err)), 500);
  }

  // Emit ship_status
  publishAgentEvent(workspaceId, sessionId, {
    streamId,
    seq: nextAgentSeq(workspaceId, sessionId),
    emittedAt: Date.now(),
    type: 'ship_status',
    executionId: execStatus.executionId,
    status:
      execStatus.status === 'confirmed'
        ? 'confirmed'
        : execStatus.status === 'mined'
          ? 'mined'
          : 'pending',
    ...(execStatus.txHash ? { txHash: execStatus.txHash } : {}),
    ...(execStatus.blockNumber !== null ? { blockNumber: execStatus.blockNumber } : {}),
  });

  // If already confirmed, persist and emit ship_confirmed immediately.
  if (execStatus.status === 'confirmed' && execStatus.contractAddress) {
    await persistShipDeployment(workspaceId, execStatus, artifactName);

    publishAgentEvent(workspaceId, sessionId, {
      streamId,
      seq: nextAgentSeq(workspaceId, sessionId),
      emittedAt: Date.now(),
      type: 'ship_confirmed',
      executionId: execStatus.executionId,
      contractAddress: execStatus.contractAddress,
      auditTrailId: execStatus.auditTrailId ?? '',
      explorerUrl:
        execStatus.explorerUrl ?? `https://sepolia.etherscan.io/tx/${execStatus.txHash ?? ''}`,
      chainId: 11155111,
    });

    return c.json(
      ExecutingResponseSchema.parse({
        phase: 'executing',
        executionId: execStatus.executionId,
        txHash: execStatus.txHash,
        status: 'confirmed',
        contractAddress: execStatus.contractAddress,
        auditTrailId: execStatus.auditTrailId,
        explorerUrl: execStatus.explorerUrl,
      }),
      200,
    );
  }

  // Background: poll until confirmed, emitting events along the way.
  void pollUntilConfirmed(
    workspaceId,
    sessionId,
    deployerPort,
    execStatus.executionId,
    artifactName,
    streamId,
  ).catch((err) => {
    console.error(`[ship] poll failed for workspace ${workspaceId}:`, err);
  });

  return c.json(
    ExecutingResponseSchema.parse({
      phase: 'executing',
      executionId: execStatus.executionId,
      txHash: execStatus.txHash,
      status: execStatus.status,
      pollUrl: `/api/ship/status/${execStatus.executionId}`,
    }),
    200,
  );
});

// ---------------------------------------------------------------------------
// Background poll loop
// ---------------------------------------------------------------------------

async function pollUntilConfirmed(
  workspaceId: string,
  sessionId: string,
  deployerPort: number,
  executionId: string,
  artifactName: string,
  streamId: ReturnType<typeof StreamIdSchema.parse>,
  opts: { pollIntervalMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const { pollIntervalMs = 5_000, timeoutMs = 120_000 } = opts;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    let status: ExecutionStatus;
    try {
      status = await callGetExecutionStatus(deployerPort, executionId);
    } catch {
      // Transient error — keep polling.
      continue;
    }

    publishAgentEvent(workspaceId, sessionId, {
      streamId,
      seq: nextAgentSeq(workspaceId, sessionId),
      emittedAt: Date.now(),
      type: 'ship_status',
      executionId: status.executionId,
      status:
        status.status === 'confirmed'
          ? 'confirmed'
          : status.status === 'mined'
            ? 'mined'
            : 'pending',
      ...(status.txHash ? { txHash: status.txHash } : {}),
      ...(status.blockNumber !== null ? { blockNumber: status.blockNumber } : {}),
    });

    if (status.status === 'confirmed') {
      if (status.contractAddress) {
        await persistShipDeployment(workspaceId, status, artifactName);
      }

      publishAgentEvent(workspaceId, sessionId, {
        streamId,
        seq: nextAgentSeq(workspaceId, sessionId),
        emittedAt: Date.now(),
        type: 'ship_confirmed',
        executionId: status.executionId,
        contractAddress: status.contractAddress ?? '',
        auditTrailId: status.auditTrailId ?? '',
        explorerUrl: status.explorerUrl ?? `https://sepolia.etherscan.io/tx/${status.txHash ?? ''}`,
        chainId: 11155111,
      });
      return;
    }

    if (status.status === 'failed') return;
  }

  console.warn(`[ship] execution ${executionId} timed out polling`);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Persist the ship deployment record to the workspace's `deployments` JSON
 * column. This makes the Sepolia contract address accessible via
 * GET /api/workspace/:id (used by the 0G track submission).
 */
async function persistShipDeployment(
  workspaceId: string,
  status: ExecutionStatus,
  contractName: string,
): Promise<void> {
  if (!status.contractAddress || !status.txHash || !status.auditTrailId) return;

  try {
    const current = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { deployments: true },
    });

    const existing = Array.isArray(current?.deployments) ? (current.deployments as unknown[]) : [];

    const newRecord = {
      contractName,
      address: status.contractAddress,
      txHash: status.txHash,
      gasUsed: '0', // gas info not surfaced by status endpoint
      constructorArgs: [],
      network: 'sepolia',
      blockNumber: status.blockNumber ?? 0,
      deployedAt: Date.now(),
      keeperHubAuditId: status.auditTrailId,
    };

    await prisma.workspace.update({
      where: { id: workspaceId },
      data: { deployments: [...existing, newRecord] as Prisma.InputJsonValue[] },
    });

    console.log(
      `[ship] workspace ${workspaceId}: persisted Sepolia deployment ` +
        `${status.contractAddress} auditTrailId=${status.auditTrailId}`,
    );
  } catch (err) {
    console.error(`[ship] failed to persist deployment for ${workspaceId}:`, err);
  }
}
