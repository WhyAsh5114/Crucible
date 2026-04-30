/**
 * @crucible/agent — public API
 *
 * Exports the agentic loop entry point and its supporting types.
 * The backend imports `runAgentTurn` and supplies an `AgentAdapter`
 * implementation that bridges the loop to the Prisma DB, PTY manager,
 * workspace-fs, tool-exec proxy, and agent-bus.
 */

export { runAgentTurn } from './loop.ts';
export type { AgentAdapter, AgentConfig } from './loop.ts';
