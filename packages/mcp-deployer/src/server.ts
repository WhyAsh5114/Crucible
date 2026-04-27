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
        'Deploy creation bytecode to the local chain via eth_sendTransaction and return address, tx hash, and gas used.',
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

  return server;
}
