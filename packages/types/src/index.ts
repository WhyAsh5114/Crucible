/**
 * `@crucible/types` — frozen contracts shared across all Crucible packages.
 *
 * Import from this barrel for everything except MCP tool schemas, which are
 * available under `@crucible/types/mcp/<server>` to avoid bundling unrelated
 * tool definitions into clients that don't need them.
 */

export * from './primitives.ts';
export * from './chain.ts';
export * from './workspace.ts';
export * from './compiler.ts';
export * from './deployer.ts';
export * from './wallet.ts';
export * from './terminal.ts';
export * from './memory.ts';
export * from './mesh.ts';
export * from './ship.ts';
export * from './inference.ts';
export * from './api.ts';
export * from './agent-events.ts';
export * from './runtime.ts';
export * from './preview.ts';
export * from './devtools.ts';

export * as mcp from './mcp/index.ts';
export type { McpToolsCallBody, McpResponseBody } from './mcp/index.ts';
