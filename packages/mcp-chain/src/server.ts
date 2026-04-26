/**
 * McpServer factory for mcp-chain.
 *
 * Registers all chain tools using schemas from @crucible/types/mcp/chain
 * and dispatches to either real Hardhat or mock implementations based on
 * the CHAIN_MOCK environment variable.
 */

import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import {
  StartNodeInputSchema,
  GetStateInputSchema,
  SnapshotInputSchema,
  RevertInputSchema,
  MineInputSchema,
  ForkInputSchema,
  type StartNodeInput,
  type RevertInput,
  type MineInput,
  type ForkInput,
} from '@crucible/types/mcp/chain';
import { encodeBigInt } from '@crucible/types';
import { startNode, forkNode, requireNode, rpc } from './node-manager.ts';
import {
  mockStartNode,
  mockGetState,
  mockSnapshot,
  mockRevert,
  mockMine,
  mockFork,
} from './mock.ts';

const IS_MOCK = process.env['CHAIN_MOCK'] === 'true';

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

export function createChainServer(): McpServer {
  const server = new McpServer({
    name: 'crucible-chain',
    version: '0.0.0',
  });

  // ── start_node ─────────────────────────────────────────────────────────────

  server.registerTool(
    'start_node',
    {
      description:
        'Start (or restart) a local Hardhat EVM node for this workspace. ' +
        'Returns the JSON-RPC URL and chain ID.',
      inputSchema: StartNodeInputSchema,
    },
    async (input: StartNodeInput) => {
      try {
        if (IS_MOCK) return toolResult(mockStartNode());
        const node = await startNode(input);
        return toolResult({ rpcUrl: node.rpcUrl, chainId: node.chainId });
      } catch (err) {
        return errorResult(`start_node failed: ${String(err)}`);
      }
    },
  );

  // ── get_state ──────────────────────────────────────────────────────────────

  server.registerTool(
    'get_state',
    {
      description: 'Return current chain state: block number, gas price, accounts, snapshots.',
      inputSchema: GetStateInputSchema,
    },
    async () => {
      try {
        if (IS_MOCK) return toolResult(mockGetState());
        const node = requireNode();

        const [rawBlock, rawGasPrice, accounts] = await Promise.all([
          rpc<string>(node.rpcUrl, 'eth_blockNumber'),
          rpc<string>(node.rpcUrl, 'eth_gasPrice'),
          rpc<string[]>(node.rpcUrl, 'eth_accounts'),
        ]);

        const state = {
          chainId: node.chainId,
          blockNumber: parseInt(rawBlock, 16),
          gasPrice: encodeBigInt(BigInt(rawGasPrice)),
          accounts,
          isForked: node.isForked,
          ...(node.forkBlock !== undefined ? { forkBlock: node.forkBlock } : {}),
          activeSnapshotIds: node.snapshotIds,
        };
        return toolResult(state);
      } catch (err) {
        return errorResult(`get_state failed: ${String(err)}`);
      }
    },
  );

  // ── snapshot ───────────────────────────────────────────────────────────────

  server.registerTool(
    'snapshot',
    {
      description: 'Take an EVM snapshot of the current chain state. Returns a snapshot ID.',
      inputSchema: SnapshotInputSchema,
    },
    async () => {
      try {
        if (IS_MOCK) return toolResult(mockSnapshot());
        const node = requireNode();
        const snapshotId = await rpc<string>(node.rpcUrl, 'evm_snapshot');
        node.snapshotIds.push(snapshotId);
        return toolResult({ snapshotId });
      } catch (err) {
        return errorResult(`snapshot failed: ${String(err)}`);
      }
    },
  );

  // ── revert ─────────────────────────────────────────────────────────────────

  server.registerTool(
    'revert',
    {
      description: 'Revert the chain to a previously taken snapshot.',
      inputSchema: RevertInputSchema,
    },
    async ({ snapshotId }: RevertInput) => {
      try {
        if (IS_MOCK) return toolResult(mockRevert(snapshotId));
        const node = requireNode();
        const success = await rpc<boolean>(node.rpcUrl, 'evm_revert', [snapshotId]);
        // A snapshot can only be used once; remove it from tracking
        const idx = node.snapshotIds.indexOf(snapshotId);
        if (idx !== -1) node.snapshotIds.splice(idx, 1);
        return toolResult({ success });
      } catch (err) {
        return errorResult(`revert failed: ${String(err)}`);
      }
    },
  );

  // ── mine ───────────────────────────────────────────────────────────────────

  server.registerTool(
    'mine',
    {
      description: 'Mine N blocks immediately.',
      inputSchema: MineInputSchema,
    },
    async ({ blocks }: MineInput) => {
      try {
        if (IS_MOCK) return toolResult(mockMine(blocks));
        const node = requireNode();
        // hardhat_mine accepts hex-encoded block count
        await rpc(node.rpcUrl, 'hardhat_mine', [`0x${blocks.toString(16)}`]);
        const rawBlock = await rpc<string>(node.rpcUrl, 'eth_blockNumber');
        return toolResult({ newBlockNumber: parseInt(rawBlock, 16) });
      } catch (err) {
        return errorResult(`mine failed: ${String(err)}`);
      }
    },
  );

  // ── fork ───────────────────────────────────────────────────────────────────

  server.registerTool(
    'fork',
    {
      description: 'Switch the running node to fork from an external RPC endpoint.',
      inputSchema: ForkInputSchema,
    },
    async (input: ForkInput) => {
      try {
        if (IS_MOCK) return toolResult(mockFork());
        const node = requireNode();
        await forkNode(node.rpcUrl, {
          rpcUrl: input.rpcUrl,
          ...(input.blockNumber !== undefined ? { blockNumber: input.blockNumber } : {}),
        });
        node.isForked = true;
        node.snapshotIds = [];
        if (input.blockNumber !== undefined) node.forkBlock = input.blockNumber;
        return toolResult({ rpcUrl: node.rpcUrl, chainId: node.chainId });
      } catch (err) {
        return errorResult(`fork failed: ${String(err)}`);
      }
    },
  );

  return server;
}
