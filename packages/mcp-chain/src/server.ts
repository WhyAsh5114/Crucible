/**
 * McpServer factory for mcp-chain.
 *
 * Registers all chain tools using schemas from @crucible/types/mcp/chain
 * and dispatches to real Hardhat implementations.
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

export function createChainServer(workspaceId: string): McpServer {
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
        const node = await startNode(workspaceId, input);
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
        const node = requireNode(workspaceId);

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
        const node = requireNode(workspaceId);
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
        const node = requireNode(workspaceId);
        const success = await rpc<boolean>(node.rpcUrl, 'evm_revert', [snapshotId]);
        // evm_revert consumes the target snapshot and invalidates all later ones.
        if (success) {
          const idx = node.snapshotIds.indexOf(snapshotId);
          if (idx !== -1) {
            node.snapshotIds.splice(idx);
          } else {
            node.snapshotIds = [];
          }
        }
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
        const node = requireNode(workspaceId);
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
      description:
        'Switch the running node to fork from an external RPC endpoint. Requires start_node to have been called first.',
      inputSchema: ForkInputSchema,
    },
    async (input: ForkInput) => {
      try {
        const node = requireNode(workspaceId);
        await forkNode(node.rpcUrl, {
          rpcUrl: input.rpcUrl,
          ...(input.blockNumber !== undefined ? { blockNumber: input.blockNumber } : {}),
        });
        node.isForked = true;
        node.snapshotIds = [];
        // Always update forkBlock — clear it when forking to latest.
        if (input.blockNumber !== undefined) {
          node.forkBlock = input.blockNumber;
        } else {
          delete node.forkBlock;
        }
        return toolResult({ rpcUrl: node.rpcUrl, chainId: node.chainId });
      } catch (err) {
        return errorResult(`fork failed: ${String(err)}`);
      }
    },
  );

  return server;
}
