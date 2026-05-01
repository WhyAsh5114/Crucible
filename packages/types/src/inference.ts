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
 * is `0g-compute`, `attestation` carries the verifiable inference receipt
 * (the full `x_0g_trace` JSON, including `tee_verified` when supported by the
 * serving provider). In fallback mode, `attestation` is null and
 * `fallbackReason` is populated.
 *
 * `fallbackReason` is also populated on 0g-compute receipts when the Router
 * call failed (rate limit, balance exhausted, provider unavailable) so the UI
 * can explain a failed turn without conflating it with an OpenAI-compatible
 * fallback that did not actually run.
 */
export const InferenceReceiptSchema = z.object({
  id: InferenceReceiptIdSchema,
  provider: InferenceProviderSchema,
  model: z.string().min(1),
  /** JSON-stringified `x_0g_trace` from the 0G Compute Router. Null for fallback. */
  attestation: z.string().nullable(),
  /**
   * Set when fallback was triggered, OR when 0G Compute itself failed with a
   * recoverable error (so the UI can explain the failure on the receipt).
   */
  fallbackReason: FallbackReasonSchema.nullable(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  createdAt: TimestampMsSchema,
});
export type InferenceReceipt = z.infer<typeof InferenceReceiptSchema>;
