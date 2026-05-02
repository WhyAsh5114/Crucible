/**
 * `memory-mcp` — 0G Storage KV (recall index) + Log (full history) wrapper.
 */

import { z } from 'zod';
import {
  MemoryPatternSchema,
  MemoryRecallHitSchema,
  MemoryProvenanceSchema,
  MemoryScopeSchema,
} from '../memory.ts';
import { HashSchema, PatternIdSchema } from '../primitives.ts';

export const RecallInputSchema = z
  .object({
    revertSignature: z.string().min(1).optional(),
    contractPattern: z.string().min(1).optional(),
    freeform: z.string().min(1).optional(),
    /** Cap on hits returned; default is server-defined (typically 5). */
    limit: z.number().int().positive().max(50).optional(),
  })
  .refine((v) => Boolean(v.revertSignature ?? v.contractPattern ?? v.freeform), {
    message: 'recall requires at least one of revertSignature, contractPattern, freeform',
  });
export const RecallOutputSchema = z.object({ hits: z.array(MemoryRecallHitSchema) });
export type RecallInput = z.infer<typeof RecallInputSchema>;
export type RecallOutput = z.infer<typeof RecallOutputSchema>;

export const RememberInputSchema = z.object({
  revertSignature: z.string().min(1),
  patch: z.string().min(1),
  /** Reference to the trace stored in the Log layer. */
  traceRef: z.string().min(1),
  verificationReceipt: HashSchema,
  scope: MemoryScopeSchema,
});
export const RememberOutputSchema = z.object({ id: PatternIdSchema });
export type RememberInput = z.infer<typeof RememberInputSchema>;
export type RememberOutput = z.infer<typeof RememberOutputSchema>;

export const ListPatternsInputSchema = z.object({
  scope: MemoryScopeSchema.optional(),
  limit: z.number().int().positive().max(200).optional(),
  /** Opaque pagination cursor returned in the previous page. */
  cursor: z.string().min(1).optional(),
});
export const ListPatternsOutputSchema = z.object({
  patterns: z.array(MemoryPatternSchema),
  nextCursor: z.string().min(1).nullable(),
});
export type ListPatternsInput = z.infer<typeof ListPatternsInputSchema>;
export type ListPatternsOutput = z.infer<typeof ListPatternsOutputSchema>;

export const ProvenanceInputSchema = z.object({ id: PatternIdSchema });
export const ProvenanceOutputSchema = MemoryProvenanceSchema;
export type ProvenanceInput = z.infer<typeof ProvenanceInputSchema>;
export type ProvenanceOutput = z.infer<typeof ProvenanceOutputSchema>;

export const PurgeInputSchema = z.object({
  scope: MemoryScopeSchema.optional(),
});
export const PurgeOutputSchema = z.object({ deleted: z.number().int().nonnegative() });
export type PurgeInput = z.infer<typeof PurgeInputSchema>;
export type PurgeOutput = z.infer<typeof PurgeOutputSchema>;

export const tools = {
  recall: { input: RecallInputSchema, output: RecallOutputSchema },
  remember: { input: RememberInputSchema, output: RememberOutputSchema },
  list_patterns: { input: ListPatternsInputSchema, output: ListPatternsOutputSchema },
  provenance: { input: ProvenanceInputSchema, output: ProvenanceOutputSchema },
  purge: { input: PurgeInputSchema, output: PurgeOutputSchema },
} as const;
