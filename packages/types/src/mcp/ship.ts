/**
 * `KeeperHub MCP` — the only sanctioned path for public-chain transactions.
 *
 * KeeperHub is an external service; this module only describes the shape of
 * the calls we make to it. The actual MCP client lives in `packages/agent`.
 */

import { z } from 'zod';
import {
  KeeperHubExecutionSchema,
  KeeperHubStatusSchema,
  ShipTxSchema,
} from '../ship.ts';
import {
  AuditTrailIdSchema,
  BigIntStringSchema,
  HashSchema,
  PublicChainTargetSchema,
} from '../primitives.ts';

export const SimulateBundleInputSchema = z.object({
  network: PublicChainTargetSchema,
  txs: z.array(ShipTxSchema).min(1),
});
export const SimulateBundleOutputSchema = z.object({
  results: z.array(
    z.object({
      gasEstimate: BigIntStringSchema,
      /** Decoded revert reason from simulation, if any. */
      revertReason: z.string().optional(),
    }),
  ),
});
export type SimulateBundleInput = z.infer<typeof SimulateBundleInputSchema>;
export type SimulateBundleOutput = z.infer<typeof SimulateBundleOutputSchema>;

export const EstimateGasInputSchema = z.object({
  network: PublicChainTargetSchema,
  tx: ShipTxSchema,
});
export const EstimateGasOutputSchema = z.object({
  gasEstimate: BigIntStringSchema,
  /** Confidence in [0, 1] — KeeperHub's heuristic. */
  confidence: z.number().min(0).max(1),
});
export type EstimateGasInput = z.infer<typeof EstimateGasInputSchema>;
export type EstimateGasOutput = z.infer<typeof EstimateGasOutputSchema>;

export const ExecuteTxInputSchema = z.object({
  network: PublicChainTargetSchema,
  tx: ShipTxSchema,
  options: z
    .object({
      /** Use private routing where supported (e.g. Flashbots Protect). */
      privateRouting: z.boolean().optional(),
      /** Cap on retries before KeeperHub gives up. */
      maxRetries: z.number().int().nonnegative().max(20).optional(),
    })
    .optional(),
});
export const ExecuteTxOutputSchema = KeeperHubExecutionSchema;
export type ExecuteTxInput = z.infer<typeof ExecuteTxInputSchema>;
export type ExecuteTxOutput = z.infer<typeof ExecuteTxOutputSchema>;

export const GetExecutionStatusInputSchema = z.object({
  /** Either a tx hash or an audit-trail ID may identify an execution. */
  txHash: HashSchema.optional(),
  auditTrailId: AuditTrailIdSchema.optional(),
}).refine(
  (v) => Boolean(v.txHash ?? v.auditTrailId),
  { message: 'one of txHash or auditTrailId is required' },
);
export const GetExecutionStatusOutputSchema = z.object({
  status: KeeperHubStatusSchema,
  retries: z.number().int().nonnegative(),
  execution: KeeperHubExecutionSchema,
});
export type GetExecutionStatusInput = z.infer<typeof GetExecutionStatusInputSchema>;
export type GetExecutionStatusOutput = z.infer<typeof GetExecutionStatusOutputSchema>;

export const tools = {
  simulate_bundle: { input: SimulateBundleInputSchema, output: SimulateBundleOutputSchema },
  estimate_gas: { input: EstimateGasInputSchema, output: EstimateGasOutputSchema },
  execute_tx: { input: ExecuteTxInputSchema, output: ExecuteTxOutputSchema },
  get_execution_status: {
    input: GetExecutionStatusInputSchema,
    output: GetExecutionStatusOutputSchema,
  },
} as const;
