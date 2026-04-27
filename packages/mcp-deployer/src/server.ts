import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import {
  DeployLocalInputSchema,
  SimulateLocalInputSchema,
  TraceInputSchema,
  CallInputSchema,
  type DeployLocalInput,
  type SimulateLocalInput,
  type TraceInput,
  type CallInput,
} from '@crucible/types/mcp/deployer';
import { createDeployerService } from './service.ts';

const TAG = '[mcp-deployer]';
const log = (msg: string) => console.log(`${TAG} ${msg}`);
const logError = (msg: string) => console.error(`${TAG} ${msg}`);

function toolResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export function createDeployerServer(opts: {
  chainRpcUrl: string;
  workspaceRoot: string;
  compilerUrl?: string;
}): McpServer {
  const service = createDeployerService(opts);
  const server = new McpServer({
    name: 'crucible-deployer',
    version: '0.0.0',
  });

  server.registerTool(
    'deploy_local',
    {
      title: 'Deploy Contract Locally',
      description:
        'Deploy a compiled contract to the local chain by name. ' +
        'Requires the contract to have been compiled first (run compile via compiler-mcp). ' +
        'Bytecode is fetched automatically from the artifact store. ' +
        'Returns contract address, tx hash, and gas used.',
      inputSchema: DeployLocalInputSchema,
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (input: DeployLocalInput) => {
      try {
        log('tool:deploy_local');
        const output = await service.deployLocal(input);
        log(`tool:deploy_local ok  address=${output.address} txHash=${output.txHash}`);
        return toolResult(output);
      } catch (err) {
        logError(`tool:deploy_local error: ${String(err)}`);
        return errorResult(`deploy_local failed: ${String(err)}`);
      }
    },
  );

  server.registerTool(
    'simulate_local',
    {
      title: 'Simulate Local Transaction',
      description:
        'Run eth_call + eth_estimateGas without mining and return call result, estimate, and optional revert reason.',
      inputSchema: SimulateLocalInputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: SimulateLocalInput) => {
      try {
        log('tool:simulate_local');
        const output = await service.simulateLocal(input);
        log(`tool:simulate_local ok  gasEstimate=${output.gasEstimate}`);
        return toolResult(output);
      } catch (err) {
        logError(`tool:simulate_local error: ${String(err)}`);
        return errorResult(`simulate_local failed: ${String(err)}`);
      }
    },
  );

  server.registerTool(
    'trace',
    {
      title: 'Trace Transaction',
      description:
        'Fetch debug trace for a transaction from Hardhat and return decoded call frames plus gas and optional revert reason.',
      inputSchema: TraceInputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: TraceInput) => {
      try {
        log(`tool:trace txHash=${input.txHash}`);
        const output = await service.trace(input);
        log(`tool:trace ok  gasUsed=${output.gasUsed}`);
        return toolResult(output);
      } catch (err) {
        logError(`tool:trace error: ${String(err)}`);
        return errorResult(`trace failed: ${String(err)}`);
      }
    },
  );

  server.registerTool(
    'call',
    {
      title: 'Read-only Contract Call',
      description: 'Execute eth_call for read-only contract queries and return the raw hex result.',
      inputSchema: CallInputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: CallInput) => {
      try {
        log('tool:call');
        const output = await service.call(input);
        log('tool:call ok');
        return toolResult(output);
      } catch (err) {
        logError(`tool:call error: ${String(err)}`);
        return errorResult(`call failed: ${String(err)}`);
      }
    },
  );

  // ── prompts ────────────────────────────────────────────────────────────────

  server.registerPrompt(
    'deployer_workflow',
    {
      title: 'Deployer Workflow',
      description:
        'Guide for deploying compiled contracts, simulating transactions, and tracing reverts on the local chain.',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'You are connected to the crucible-deployer MCP server.',
              '',
              'Prerequisites: a running Hardhat node (start via crucible-chain) and at least one',
              'compiled contract (compile via crucible-compiler).',
              '',
              'Typical workflow:',
              '1. Call deploy_local(contractName, constructorData) to deploy a compiled contract.',
              '   - contractName must match a contract compiled by crucible-compiler.',
              '   - constructorData is the ABI-encoded constructor arguments ("0x" if none).',
              '   - Returns { address, txHash, gasUsed }.',
              '2. Call simulate_local(to, data, from?) to dry-run a call without mining.',
              '   - Returns { result, gasEstimate, revertReason?, logs }.',
              '   - Use before sending real transactions to detect reverts early.',
              '3. Call call(to, data, from?) for read-only view/pure function calls.',
              '4. Call trace(txHash) to get a decoded call trace for a mined transaction.',
              '   - Returns decoded call frames, storage reads/writes, events, and revert reason.',
              '',
              'Tool reference:',
              '  deploy_local    — Deploy a compiled contract by name; auto-fetches bytecode.',
              '  simulate_local  — Dry-run a transaction (no state change).',
              '  call            — Read-only eth_call.',
              '  trace           — Debug trace a mined transaction.',
              '',
              'Notes:',
              '  - If deploy_local fails with "Contract not found", run compile in crucible-compiler.',
              '  - sender defaults to the first funded Hardhat account.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'debug_revert',
    {
      title: 'Debug a Revert',
      description:
        'Step-by-step guide for diagnosing transaction reverts using simulate and trace.',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'Debugging a revert with crucible-deployer:',
              '',
              'Option A — Before sending (preferred):',
              '1. Call simulate_local with the same to, data, and from as your intended tx.',
              '   - If it reverts, revertReason will contain the decoded error.',
              '   - Fix the inputs or contract logic before proceeding.',
              '',
              'Option B — After a mined revert:',
              '1. Get the txHash of the failed transaction.',
              '2. Call trace(txHash) to get a full decoded call trace.',
              '   - revertReason shows the innermost revert message.',
              '   - decodedCalls shows the full call stack leading to the revert.',
              '   - storageReads/storageWrites show exactly what state was touched.',
              '',
              'Option C — Pattern matching (with crucible-memory):',
              '1. Take the revertReason from simulate or trace.',
              '2. Call recall(query) in crucible-memory with the revert signature.',
              '   - Returns previously verified fix patterns for similar errors.',
              '3. Apply the suggested fix, re-simulate, and confirm the revert is gone.',
              '4. Call remember(pattern) to persist the fix for future use.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  return server;
}
