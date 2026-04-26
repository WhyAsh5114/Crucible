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
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `JSON-RPC request failed: HTTP ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`,
    );
  }
  let data: { result?: T; error?: { message: string } };
  try {
    data = (await res.json()) as { result?: T; error?: { message: string } };
  } catch (e) {
    throw new Error(`JSON-RPC (${method}): failed to parse response — ${String(e)}`, { cause: e });
  }
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

/** Per-workspace node state — one Hardhat node per workspace. */
const nodes = new Map<string, NodeEntry>();

export function getNode(workspaceId: string): NodeEntry | null {
  return nodes.get(workspaceId) ?? null;
}

export function requireNode(workspaceId: string): NodeEntry {
  const node = nodes.get(workspaceId);
  if (!node)
    throw new Error(
      `No active Hardhat node for workspace "${workspaceId}" — call start_node first`,
    );
  return node;
}

/** Stop the node for a workspace and remove it from the registry. */
export async function stopNode(workspaceId: string): Promise<void> {
  const node = nodes.get(workspaceId);
  if (node) {
    await node.server.close();
    nodes.delete(workspaceId);
  }
}

/** Start (or restart) the Hardhat node for the given workspace. */
export async function startNode(workspaceId: string, input: StartNodeInput): Promise<NodeEntry> {
  // Kill any previously running node for this workspace
  const existing = nodes.get(workspaceId);
  if (existing) {
    await existing.server.close();
    nodes.delete(workspaceId);
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
  nodes.set(workspaceId, entry);
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
