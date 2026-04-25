/**
 * Persistent agent memory layer (0G Storage KV + Log).
 *
 * `MemoryPattern` is the verified `{revert → patch}` triple that the
 * self-healing loop writes back after a successful repair. `MemoryRecallHit`
 * is what the agent gets back when it queries by revert signature.
 */

import { z } from 'zod';
import {
  HashSchema,
  NodeIdSchema,
  PatternIdSchema,
  TimestampMsSchema,
} from './primitives.ts';

export const MemoryScopeSchema = z.enum(['local', 'mesh']);
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const MemoryProvenanceSchema = z.object({
  authorNode: NodeIdSchema,
  /** Crucible session that originally produced the pattern. */
  originalSession: z.string().min(1),
  /** Patterns this one was derived from (e.g. via mesh propagation). */
  derivedFrom: z.array(PatternIdSchema).optional(),
});
export type MemoryProvenance = z.infer<typeof MemoryProvenanceSchema>;

export const MemoryPatternSchema = z.object({
  id: PatternIdSchema,
  /**
   * Stable signature of the revert. For `Error(string)` reverts this is the
   * decoded message; for custom errors it is the 4-byte selector + decoded
   * args; for opcode reverts it is the opcode + PC offset. Producers MUST
   * normalize this before writing.
   */
  revertSignature: z.string().min(1),
  /** Unified diff applied to the workspace files to fix the revert. */
  patch: z.string().min(1),
  /** Reference to the full trace stored in the 0G Storage Log layer. */
  traceRef: z.string().min(1),
  /** Verification receipt produced by the local snapshot replay. */
  verificationReceipt: HashSchema,
  provenance: MemoryProvenanceSchema,
  scope: MemoryScopeSchema,
  createdAt: TimestampMsSchema,
});
export type MemoryPattern = z.infer<typeof MemoryPatternSchema>;

export const MemoryRecallHitSchema = z.object({
  pattern: MemoryPatternSchema,
  /** Similarity score in [0, 1]. Recall ranks results by this. */
  score: z.number().min(0).max(1),
});
export type MemoryRecallHit = z.infer<typeof MemoryRecallHitSchema>;
