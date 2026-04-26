/**
 * NodeManager — per-workspace Hardhat node lifecycle.
 *
 * Each call to `startNode()` creates a fresh in-process Hardhat v3 node
 * bound to a dynamically allocated loopback port and stores its state.
 * All subsequent JSON-RPC calls (snapshot, revert, mine …) are forwarded
 * to that HTTP endpoint.
 */

import { defineConfig } from 'hardhat/config';
import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import type { Address } from 'viem';
import type { StartNodeInput } from '@crucible/types/mcp/chain';

/** Send a single JSON-RPC call and return the `result` field. */
export async function rpc<T = unknown>(
  rpcUrl: string,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  const data = (await res.json()) as { result?: T; error?: { message: string } };
  if (data.error) throw new Error(`JSON-RPC error (${method}): ${data.error.message}`);
  return data.result as T;
}

export interface NodeEntry {
  rpcUrl: string;
  chainId: number;
  accounts: Address[];
  snapshotIds: string[];
  isForked: boolean;
  forkBlock?: number;
  server: { close(): Promise<void> };
}

/** Singleton node state — one Hardhat node per MCP server instance. */
let currentNode: NodeEntry | null = null;

export function getNode(): NodeEntry | null {
  return currentNode;
}

export function requireNode(): NodeEntry {
  if (!currentNode) throw new Error('No active Hardhat node — call start_node first');
  return currentNode;
}

/** Start (or restart) the local Hardhat node. */
export async function startNode(input: StartNodeInput): Promise<NodeEntry> {
  // Kill any previously running node for this server instance
  if (currentNode) {
    await currentNode.server.close();
    currentNode = null;
  }

  const forkingConfig =
    input.fork !== undefined
      ? {
          url: input.fork.rpcUrl,
          ...(input.fork.blockNumber !== undefined ? { blockNumber: input.fork.blockNumber } : {}),
        }
      : undefined;

  const config = defineConfig({
    networks: {
      hardhat:
        forkingConfig !== undefined
          ? {
              type: 'edr-simulated' as const,
              chainId: 31337,
              loggingEnabled: false,
              forking: forkingConfig,
            }
          : { type: 'edr-simulated' as const, chainId: 31337, loggingEnabled: false },
    },
  });

  const hre = await createHardhatRuntimeEnvironment(config);

  const server = await hre.network.createServer({ network: 'hardhat' }, '127.0.0.1', 0);

  const { address, port } = await server.listen();
  const rpcUrl = `http://${address}:${port}`;

  const chainId = (await rpc<string>(rpcUrl, 'eth_chainId')) as string;
  const accounts = (await rpc<string[]>(rpcUrl, 'eth_accounts')) as string[];

  const isForked = !!input.fork;
  let forkBlock: number | undefined;

  if (isForked) {
    const meta = (await rpc<{
      forkedNetwork?: { chainId: number; forkBlockNumber: number };
    }>(rpcUrl, 'hardhat_metadata')) as {
      forkedNetwork?: { chainId: number; forkBlockNumber: number };
    };
    forkBlock = meta.forkedNetwork?.forkBlockNumber;
  }

  const entry: NodeEntry = {
    rpcUrl,
    chainId: parseInt(chainId, 16),
    accounts: accounts as Address[],
    snapshotIds: [],
    isForked,
    server,
    ...(forkBlock !== undefined ? { forkBlock } : {}),
  };
  currentNode = entry;
  return entry;
}

/** Reset the node by sending hardhat_reset, preserving fork config if any. */
export async function forkNode(
  rpcUrl: string,
  forkConfig: { rpcUrl: string; blockNumber?: number },
): Promise<void> {
  await rpc(rpcUrl, 'hardhat_reset', [
    {
      forking: {
        jsonRpcUrl: forkConfig.rpcUrl,
        ...(forkConfig.blockNumber !== undefined ? { blockNumber: forkConfig.blockNumber } : {}),
      },
    },
  ]);
}
