/**
 * Agent event stream — frames sent from backend to frontend over
 * `wss://crucible.localhost/ws/agent?streamId=<id>`.
 *
 * Discriminated on `type` so consumers get exhaustive narrowing. Every variant
 * carries a `streamId` (so multiplexed connections are possible later) and a
 * `seq` monotonically-increasing sequence number per stream.
 */

import { z } from 'zod';
import { TxTraceSchema } from './deployer.ts';
import { InferenceReceiptSchema } from './inference.ts';
import { KeeperHubExecutionSchema } from './ship.ts';
import { MemoryPatternSchema, MemoryRecallHitSchema } from './memory.ts';
import { MeshHelpRequestSchema, MeshHelpResponseSchema } from './mesh.ts';
import {
  CallIdSchema,
  HashSchema,
  HelpRequestIdSchema,
  PatternIdSchema,
  StreamIdSchema,
  TimestampMsSchema,
} from './primitives.ts';
import { WorkspaceFileLangSchema } from './workspace.ts';

const base = z.object({
  streamId: StreamIdSchema,
  /** Monotonic per-stream sequence number, starting at 0. */
  seq: z.number().int().nonnegative(),
  emittedAt: TimestampMsSchema,
});

/** The agent's plan-step narration. Plain text intended for the chat rail. */
const Thinking = base.extend({
  type: z.literal('thinking'),
  text: z.string(),
});

/**
 * The agent invoked an MCP tool. `tool` is the dotted address `<server>.<tool>`,
 * e.g. `chain.snapshot`. `args` is opaque here; the per-tool schemas in
 * `./mcp/*` describe the real shape.
 */
const ToolCall = base.extend({
  type: z.literal('tool_call'),
  callId: CallIdSchema,
  tool: z.string().regex(/^[a-z][a-z0-9-]*\.[a-z_]+$/u),
  args: z.unknown(),
});

const ToolResult = base.extend({
  type: z.literal('tool_result'),
  callId: CallIdSchema,
  /** Discriminated on `ok` so callers don't have to pattern-match `error`. */
  outcome: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), result: z.unknown() }),
    z.object({ ok: z.literal(false), error: z.string() }),
  ]),
});

/** The agent wrote a workspace file. The frontend should refresh from the
 *  backend rather than trusting `content` directly for very large files. */
const FileWrite = base.extend({
  type: z.literal('file_write'),
  path: z.string().min(1),
  lang: WorkspaceFileLangSchema,
  /** Sha256 hex of post-write file contents. */
  hash: z.string().regex(/^[0-9a-f]{64}$/u),
  /** Inline content for small files. Omitted when the file exceeds the
   *  backend's inline threshold; consumers should re-fetch via `WorkspaceState`. */
  content: z.string().optional(),
});

const Message = base.extend({
  type: z.literal('message'),
  /** Markdown-safe content for the chat rail. */
  content: z.string(),
});

const InferenceReceiptEvent = base.extend({
  type: z.literal('inference_receipt'),
  receipt: InferenceReceiptSchema,
});

const RevertDetected = base.extend({
  type: z.literal('revert_detected'),
  txHash: HashSchema,
  revertSignature: z.string(),
});

const TraceCaptured = base.extend({
  type: z.literal('trace_captured'),
  trace: TxTraceSchema,
});

const MemoryRecall = base.extend({
  type: z.literal('memory_recall'),
  /** Empty array means "no hits — agent will reason or ask the mesh". */
  hits: z.array(MemoryRecallHitSchema),
});

const MeshHelpBroadcast = base.extend({
  type: z.literal('mesh_help_broadcast'),
  request: MeshHelpRequestSchema,
});

const MeshHelpReceived = base.extend({
  type: z.literal('mesh_help_received'),
  reqId: HelpRequestIdSchema,
  responses: z.array(MeshHelpResponseSchema),
});

const PatchProposed = base.extend({
  type: z.literal('patch_proposed'),
  source: z.enum(['memory', 'mesh', 'reasoning']),
  /** Unified diff. */
  patch: z.string(),
});

const PatchVerified = base.extend({
  type: z.literal('patch_verified'),
  /** Hash of the local replay that confirmed the patch. */
  localReceipt: HashSchema,
});

const PatchCommitted = base.extend({
  type: z.literal('patch_committed'),
  /** Pattern record written to memory as the result of this commit. */
  pattern: MemoryPatternSchema,
});

const KeeperHubExecutionEvent = base.extend({
  type: z.literal('keeperhub_execution'),
  execution: KeeperHubExecutionSchema,
});

const Done = base.extend({
  type: z.literal('done'),
});

const ErrorEvent = base.extend({
  type: z.literal('error'),
  message: z.string(),
});

export const AgentEventSchema = z.discriminatedUnion('type', [
  Thinking,
  ToolCall,
  ToolResult,
  FileWrite,
  Message,
  InferenceReceiptEvent,
  RevertDetected,
  TraceCaptured,
  MemoryRecall,
  MeshHelpBroadcast,
  MeshHelpReceived,
  PatchProposed,
  PatchVerified,
  PatchCommitted,
  KeeperHubExecutionEvent,
  Done,
  ErrorEvent,
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;

/** Convenience union of just the discriminator literals — useful for
 *  exhaustiveness checks in switch statements. */
export type AgentEventType = AgentEvent['type'];
