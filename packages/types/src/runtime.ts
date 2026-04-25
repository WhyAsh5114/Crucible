/**
 * Control-plane ↔ workspace-runtime envelope.
 *
 * Per docs/PLAN.md the runtime boundary is sacred: the same product must run
 * either as host child processes (trusted demo mode) or as isolated runner
 * containers (public deployment). The control plane MUST only talk to a
 * runtime through the messages defined here.
 */

import { z } from 'zod';
import {
  PortSchema,
  RuntimeIdSchema,
  TerminalSessionIdSchema,
  TimestampMsSchema,
  WorkspaceIdSchema,
} from './primitives.ts';
import { ChainStateSchema } from './chain.ts';

export const RuntimeStatusSchema = z.enum(['starting', 'ready', 'degraded', 'crashed', 'stopped']);
export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;

/** What the control plane needs to know to point traffic at a runtime. */
export const RuntimeDescriptorSchema = z.object({
  runtimeId: RuntimeIdSchema,
  workspaceId: WorkspaceIdSchema,
  status: RuntimeStatusSchema,
  startedAt: TimestampMsSchema,
  /** Live preview URL once the dev server is up. */
  previewUrl: z.url().nullable(),
  /** Active terminal session attached to the workspace shell. */
  terminalSessionId: TerminalSessionIdSchema.nullable(),
  /** Loopback ports used by the runtime's internal services. */
  ports: z.object({
    chain: PortSchema.nullable(),
    compiler: PortSchema.nullable(),
    deployer: PortSchema.nullable(),
    wallet: PortSchema.nullable(),
    terminal: PortSchema.nullable(),
  }),
  chainState: ChainStateSchema.nullable(),
});
export type RuntimeDescriptor = z.infer<typeof RuntimeDescriptorSchema>;

// --- Runtime control messages -----------------------------------------------
//
// All messages are JSON, all carry a correlation id, and all responses use
// the same `correlationId`. The control plane is the only initiator.

const corr = { correlationId: z.string().min(1) };

export const OpenWorkspaceRequestSchema = z.object({
  ...corr,
  type: z.literal('open_workspace'),
  workspaceId: WorkspaceIdSchema,
});

export const CloseWorkspaceRequestSchema = z.object({
  ...corr,
  type: z.literal('close_workspace'),
  workspaceId: WorkspaceIdSchema,
});

export const RuntimeStatusRequestSchema = z.object({
  ...corr,
  type: z.literal('runtime_status'),
});

/**
 * Generic tool execution envelope. The control plane forwards an MCP tool
 * call to the runtime without coupling to any specific server. The agent
 * keeps using its existing MCP client; the runtime resolves `server` to the
 * appropriate loopback service.
 */
export const ToolExecRequestSchema = z.object({
  ...corr,
  type: z.literal('tool_exec'),
  workspaceId: WorkspaceIdSchema,
  /** Logical MCP server name: `chain` | `compiler` | `deployer` | `wallet` | `terminal`. */
  server: z.enum(['chain', 'compiler', 'deployer', 'wallet', 'terminal']),
  tool: z.string().min(1),
  args: z.unknown(),
});

export const RuntimeRequestSchema = z.discriminatedUnion('type', [
  OpenWorkspaceRequestSchema,
  CloseWorkspaceRequestSchema,
  RuntimeStatusRequestSchema,
  ToolExecRequestSchema,
]);
export type RuntimeRequest = z.infer<typeof RuntimeRequestSchema>;

// --- Runtime responses -------------------------------------------------------

const respBase = z.object({ correlationId: z.string().min(1) });

const OpenWorkspaceResponse = respBase.extend({
  type: z.literal('open_workspace'),
  descriptor: RuntimeDescriptorSchema,
});

const CloseWorkspaceResponse = respBase.extend({
  type: z.literal('close_workspace'),
  ok: z.literal(true),
});

const RuntimeStatusResponse = respBase.extend({
  type: z.literal('runtime_status'),
  descriptors: z.array(RuntimeDescriptorSchema),
});

const ToolExecResponse = respBase.extend({
  type: z.literal('tool_exec'),
  outcome: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), result: z.unknown() }),
    z.object({ ok: z.literal(false), error: z.string() }),
  ]),
});

export const RuntimeResponseSchema = z.discriminatedUnion('type', [
  OpenWorkspaceResponse,
  CloseWorkspaceResponse,
  RuntimeStatusResponse,
  ToolExecResponse,
]);
export type RuntimeResponse = z.infer<typeof RuntimeResponseSchema>;

// --- Server-pushed runtime events --------------------------------------------
//
// The runtime may also push status updates to the control plane unsolicited
// (preview ready, chain crashed, etc).

export const RuntimeEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('descriptor_changed'),
    descriptor: RuntimeDescriptorSchema,
  }),
  z.object({
    type: z.literal('preview_ready'),
    workspaceId: WorkspaceIdSchema,
    previewUrl: z.url(),
  }),
  z.object({
    type: z.literal('chain_crashed'),
    workspaceId: WorkspaceIdSchema,
    reason: z.string(),
  }),
]);
export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;
