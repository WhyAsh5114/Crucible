/**
 * MCP server registry — port assignments and server names.
 *
 * Loopback ports per docs/ARCHITECTURE.md. These are internal; nothing
 * browser-facing should ever reference them. Production deployments may
 * expose runner-internal services on different ports, but the agent always
 * resolves servers by logical name through the runtime contract.
 */

import { z } from 'zod';
import { PortSchema } from '../primitives.ts';

export const McpServerNameSchema = z.enum([
  'chain',
  'compiler',
  'deployer',
  'wallet',
  'memory',
  'mesh',
  'terminal',
  'ship', // KeeperHub
]);
export type McpServerName = z.infer<typeof McpServerNameSchema>;

/** Default loopback ports. Override per-environment via runtime config. */
export const DEFAULT_MCP_PORTS = {
  chain: 3100,
  compiler: 3101,
  deployer: 3102,
  wallet: 3103,
  memory: 3104,
  mesh: 3105,
  terminal: 3106,
  // `ship` (KeeperHub) is external — no loopback port.
} as const satisfies Record<Exclude<McpServerName, 'ship'>, number>;

PortSchema.parse(DEFAULT_MCP_PORTS.chain);

export * as chain from './chain.ts';
export * as compiler from './compiler.ts';
export * as deployer from './deployer.ts';
export * as wallet from './wallet.ts';
export * as memory from './memory.ts';
export * as mesh from './mesh.ts';
export * as terminal from './terminal.ts';
export * as ship from './ship.ts';
