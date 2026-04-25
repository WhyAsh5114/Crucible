/**
 * Inference provider routing and receipts.
 *
 * Crucible's primary inference path is 0G Compute (sealed, verifiable receipts).
 * An OpenAI-compatible endpoint exists only as a degraded-mode reliability
 * fallback for public beta. Per docs/ARCHITECTURE.md, the active provider must
 * be visible to the user and never misrepresented.
 */

import { z } from 'zod';
import { InferenceReceiptIdSchema, TimestampMsSchema } from './primitives.ts';

export const InferenceProviderSchema = z.enum(['0g-compute', 'openai-compatible']);
export type InferenceProvider = z.infer<typeof InferenceProviderSchema>;

/**
 * Why fallback was chosen, if it was. `null` when 0G is the active provider.
 * Matches the env-flag triggers documented in docs/DEPLOYMENT.md.
 */
export const FallbackReasonSchema = z.enum([
  'rate_limited',
  'balance_exhausted',
  'provider_unavailable',
  'admin_override',
]);
export type FallbackReason = z.infer<typeof FallbackReasonSchema>;

/**
 * The receipt that accompanies every agent inference call. When the provider
 * is `0g-compute`, `attestation` carries the verifiable inference receipt. In
 * fallback mode, `attestation` is null and `fallbackReason` is populated.
 */
export const InferenceReceiptSchema = z.object({
  id: InferenceReceiptIdSchema,
  provider: InferenceProviderSchema,
  model: z.string().min(1),
  /** Opaque verifiable receipt blob from 0G Compute. Null for fallback. */
  attestation: z.string().nullable(),
  /** Populated only when `provider === 'openai-compatible'`. */
  fallbackReason: FallbackReasonSchema.nullable(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  createdAt: TimestampMsSchema,
});
export type InferenceReceipt = z.infer<typeof InferenceReceiptSchema>;
