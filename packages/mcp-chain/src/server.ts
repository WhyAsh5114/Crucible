/**
 * McpServer factory for mcp-chain.
 *
 * Registers all chain tools using schemas from @crucible/types/mcp/chain
 * and dispatches to real Hardhat implementations.
 */

import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  GetStateInputSchema,
  SnapshotInputSchema,
  RevertInputSchema,
  MineInputSchema,
  type RevertInput,
  type MineInput,
} from '@crucible/types/mcp/chain';
import { encodeBigInt } from '@crucible/types';
import { startNode, requireNode, rpc } from './node-manager.ts';

const TAG = '[mcp-chain]';
const log = (msg: string) => console.log(`${TAG} ${msg}`);
const logError = (msg: string) => console.error(`${TAG} ${msg}`);

// ── Tool-local schemas (rpcUrl optional when a server default is configured) ─

const StartNodeToolInputSchema = z.object({
  fork: z
    .object({
      rpcUrl: z.url().optional(),
      blockNumber: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
type StartNodeToolInput = z.infer<typeof StartNodeToolInputSchema>;

const ForkToolInputSchema = z.object({
  rpcUrl: z.url().optional(),
  blockNumber: z.number().int().nonnegative().optional(),
});
type ForkToolInput = z.infer<typeof ForkToolInputSchema>;

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

export function createChainServer(
  workspaceId: string,
  opts: { defaultForkRpcUrl?: string } = {},
): McpServer {
  const server = new McpServer({
    name: 'crucible-chain',
    version: '0.0.0',
  });

  // ── start_node ─────────────────────────────────────────────────────────────

  server.registerTool(
    'start_node',
    {
      title: 'Start EVM Node',
      description:
        'Start (or restart) a local Hardhat EVM node for this workspace. ' +
        'Must be called before any other chain tool. ' +
        'Returns the JSON-RPC URL and chain ID. ' +
        (opts.defaultForkRpcUrl
          ? `A default fork RPC (${opts.defaultForkRpcUrl}) is pre-configured — omit fork.rpcUrl to use it.`
          : 'Provide fork.rpcUrl to start in fork mode against an external network.'),
      inputSchema: StartNodeToolInputSchema,
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input: StartNodeToolInput) => {
      try {
        // Apply server-level default if the caller omitted fork.rpcUrl.
        const effectiveInput =
          input.fork && !input.fork.rpcUrl && opts.defaultForkRpcUrl
            ? { ...input, fork: { ...input.fork, rpcUrl: opts.defaultForkRpcUrl } }
            : input;
        if (effectiveInput.fork && !effectiveInput.fork.rpcUrl) {
          logError('tool:start_node error: fork.rpcUrl required');
          return errorResult(
            'start_node: fork.rpcUrl is required (or set DEFAULT_FORK_RPC_URL on the server)',
          );
        }
        log(
          `tool:start_node${effectiveInput.fork ? ` fork=${effectiveInput.fork.rpcUrl}${effectiveInput.fork.blockNumber !== undefined ? `@${effectiveInput.fork.blockNumber}` : ''}` : ''}`,
        );
        const node = await startNode(
          workspaceId,
          effectiveInput as Parameters<typeof startNode>[1],
        );
        log(`tool:start_node ok  rpcUrl=${node.rpcUrl} chainId=${node.chainId}`);
        return toolResult({ rpcUrl: node.rpcUrl, chainId: node.chainId });
      } catch (err) {
        logError(`tool:start_node error: ${String(err)}`);
        return errorResult(`start_node failed: ${String(err)}`);
      }
    },
  );

  // ── get_state ──────────────────────────────────────────────────────────────

  server.registerTool(
    'get_state',
    {
      title: 'Get Chain State',
      description:
        'Return current chain state: block number, gas price, accounts, and active snapshot IDs. ' +
        'Use this to inspect the node before/after operations.',
      inputSchema: GetStateInputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const node = requireNode(workspaceId);

        const [rawBlock, rawGasPrice, accounts] = await Promise.all([
          rpc<string>(node.rpcUrl, 'eth_blockNumber'),
          rpc<string>(node.rpcUrl, 'eth_gasPrice'),
          rpc<string[]>(node.rpcUrl, 'eth_accounts'),
        ]);

        const blockNumber = parseInt(rawBlock, 16);
        log(`tool:get_state ok  block=${blockNumber} accounts=${accounts.length}`);
        const state = {
          chainId: node.chainId,
          blockNumber,
          gasPrice: encodeBigInt(BigInt(rawGasPrice)),
          accounts,
          isForked: node.isForked,
          ...(node.forkBlock !== undefined ? { forkBlock: node.forkBlock } : {}),
          activeSnapshotIds: node.snapshotIds,
        };
        return toolResult(state);
      } catch (err) {
        logError(`tool:get_state error: ${String(err)}`);
        return errorResult(`get_state failed: ${String(err)}`);
      }
    },
  );

  // ── snapshot ───────────────────────────────────────────────────────────────

  server.registerTool(
    'snapshot',
    {
      title: 'Take EVM Snapshot',
      description:
        'Take an EVM snapshot of the current chain state. ' +
        'Store the returned snapshotId to revert back to this point later. ' +
        'Snapshots are cheap — take one before any destructive test.',
      inputSchema: SnapshotInputSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const node = requireNode(workspaceId);
        const snapshotId = await rpc<string>(node.rpcUrl, 'evm_snapshot');
        node.snapshotIds.push(snapshotId);
        log(`tool:snapshot ok  snapshotId=${snapshotId}`);
        return toolResult({ snapshotId });
      } catch (err) {
        logError(`tool:snapshot error: ${String(err)}`);
        return errorResult(`snapshot failed: ${String(err)}`);
      }
    },
  );

  // ── revert ─────────────────────────────────────────────────────────────────

  server.registerTool(
    'revert',
    {
      title: 'Revert to Snapshot',
      description:
        'Revert the chain to a previously taken snapshot. ' +
        'The target snapshot and all snapshots taken after it are consumed — ' +
        'take a fresh snapshot afterwards if you need to revert again.',
      inputSchema: RevertInputSchema,
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ snapshotId }: RevertInput) => {
      try {
        log(`tool:revert snapshotId=${snapshotId}`);
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
        log(`tool:revert ok  success=${success}`);
        return toolResult({ success });
      } catch (err) {
        logError(`tool:revert error: ${String(err)}`);
        return errorResult(`revert failed: ${String(err)}`);
      }
    },
  );

  // ── mine ───────────────────────────────────────────────────────────────────

  server.registerTool(
    'mine',
    {
      title: 'Mine Blocks / Advance Time',
      description:
        'Advance the local Hardhat node by mining blocks and/or jumping forward in time. ' +
        'Use `seconds` to advance EVM time by N seconds (the recommended way to clear ' +
        'cooldowns / vesting / time-locks). Use `blocks` to mine N empty blocks. ' +
        'At least one of `blocks` or `seconds` must be provided.',
      inputSchema: MineInputSchema,
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ blocks, seconds }: MineInput) => {
      try {
        log(`tool:mine blocks=${blocks ?? 0} seconds=${seconds ?? 0}`);
        const node = requireNode(workspaceId);
        if (seconds !== undefined && seconds > 0) {
          // evm_increaseTime returns the new total offset; mine one block to
          // make the new timestamp observable to subsequent reads.
          await rpc(node.rpcUrl, 'evm_increaseTime', [seconds]);
          await rpc(node.rpcUrl, 'evm_mine', []);
        }
        if (blocks !== undefined && blocks > 0) {
          await rpc(node.rpcUrl, 'hardhat_mine', [`0x${blocks.toString(16)}`]);
        }
        const rawBlock = await rpc<string>(node.rpcUrl, 'eth_blockNumber');
        const newBlockNumber = parseInt(rawBlock, 16);
        // Fetch the new block timestamp for the response.
        const blockHeader = await rpc<{ timestamp: string } | null>(
          node.rpcUrl,
          'eth_getBlockByNumber',
          ['latest', false],
        );
        const newTimestamp = blockHeader ? parseInt(blockHeader.timestamp, 16) : 0;
        log(`tool:mine ok  newBlock=${newBlockNumber} ts=${newTimestamp}`);
        return toolResult({ newBlockNumber, newTimestamp });
      } catch (err) {
        logError(`tool:mine error: ${String(err)}`);
        return errorResult(`mine failed: ${String(err)}`);
      }
    },
  );

  // ── fork ───────────────────────────────────────────────────────────────────

  server.registerTool(
    'fork',
    {
      title: 'Fork External Network',
      description:
        'Switch the running node to fork from an external RPC endpoint. ' +
        'Requires start_node to have been called first. ' +
        'Forking resets all snapshots. Optionally pin to a specific block number for reproducibility. ' +
        (opts.defaultForkRpcUrl
          ? `Default fork RPC is pre-configured (${opts.defaultForkRpcUrl}) — omit rpcUrl to use it.`
          : 'rpcUrl is required.'),
      inputSchema: ForkToolInputSchema,
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input: ForkToolInput) => {
      try {
        const effectiveRpcUrl = input.rpcUrl ?? opts.defaultForkRpcUrl;
        if (!effectiveRpcUrl) {
          logError('tool:fork error: rpcUrl required');
          return errorResult(
            'fork: rpcUrl is required (or set DEFAULT_FORK_RPC_URL on the server)',
          );
        }
        log(
          `tool:fork rpcUrl=${effectiveRpcUrl}${input.blockNumber !== undefined ? ` blockNumber=${input.blockNumber}` : ''}`,
        );
        // hardhat_reset is not supported in Hardhat v3's edr-simulated network.
        // Restart the node with fork configuration instead.
        const node = await startNode(workspaceId, {
          fork: {
            rpcUrl: effectiveRpcUrl,
            ...(input.blockNumber !== undefined ? { blockNumber: input.blockNumber } : {}),
          },
        });
        log(`tool:fork ok  rpcUrl=${node.rpcUrl} chainId=${node.chainId}`);
        return toolResult({ rpcUrl: node.rpcUrl, chainId: node.chainId });
      } catch (err) {
        logError(`tool:fork error: ${String(err)}`);
        return errorResult(`fork failed: ${String(err)}`);
      }
    },
  );

  // ── prompts ────────────────────────────────────────────────────────────────

  server.registerPrompt(
    'evm_workflow',
    {
      title: 'EVM Testing Workflow',
      description:
        'Step-by-step guide for setting up and using the Crucible EVM node for smart-contract testing.',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'You are connected to the crucible-chain MCP server, which controls a local Hardhat EVM node.',
              '',
              'Typical workflow:',
              '1. Call start_node to launch the node (or restart it with a clean state).',
              '   - Returns rpcUrl (use this in deployment/testing tools) and chainId.',
              '2. Call get_state to inspect accounts, block number, and gas price.',
              '3. Call snapshot before any destructive operation to save a restore point.',
              '4. Perform your test operations (deploy contracts, send transactions, etc.).',
              '5. Call revert with the snapshotId to roll back state between test runs.',
              '6. Call mine to fast-forward blocks when testing time-dependent logic.',
              '7. Call fork to pin the node to a mainnet/testnet state for integration tests.',
              '',
              'Tool reference:',
              '  start_node  — Start or restart the Hardhat node.',
              '  get_state   — Read-only: block number, gas price, accounts, active snapshots.',
              '  snapshot    — Save current state; returns snapshotId.',
              '  revert      — Restore to a snapshot (consumes it and later ones).',
              '  mine        — Instantly mine N blocks.',
              '  fork        — Re-target the node to an external RPC (resets snapshots).',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'fork_workflow',
    {
      title: 'Fork & Replay Workflow',
      description:
        'Guide for forking an external network and running reproducible integration tests against real on-chain state.',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'You are using the crucible-chain fork capability.',
              '',
              'Steps for a reproducible fork-based integration test:',
              '1. Call start_node to bring up the local node.',
              '2. Call fork with the external rpcUrl and a fixed blockNumber.',
              '   - Pinning blockNumber ensures the test is reproducible across runs.',
              '3. Call snapshot immediately after forking to mark the clean fork baseline.',
              '4. Run your integration tests.',
              '5. Call revert to return to the fork baseline between test scenarios.',
              '',
              'Tips:',
              '  - Use a reliable archive RPC endpoint (e.g. Alchemy, Infura) for forks.',
              '  - Always pin blockNumber for CI reproducibility.',
              '  - After revert the snapshotId is consumed — take a new snapshot if needed.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  return server;
}
