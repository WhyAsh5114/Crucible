/**
 * `chain-mcp` — local Hardhat lifecycle and state.
 */

import { z } from 'zod';
import { ChainStateSchema } from '../chain.ts';
import { BlockNumberSchema, ChainIdSchema, SnapshotIdSchema } from '../primitives.ts';

export const StartNodeInputSchema = z.object({
  fork: z
    .object({
      rpcUrl: z.url(),
      blockNumber: BlockNumberSchema.optional(),
    })
    .optional(),
});
export const StartNodeOutputSchema = z.object({
  rpcUrl: z.url(),
  chainId: ChainIdSchema,
});
export type StartNodeInput = z.infer<typeof StartNodeInputSchema>;
export type StartNodeOutput = z.infer<typeof StartNodeOutputSchema>;

export const GetStateInputSchema = z.object({});
export const GetStateOutputSchema = ChainStateSchema;
export type GetStateOutput = z.infer<typeof GetStateOutputSchema>;

export const SnapshotInputSchema = z.object({});
export const SnapshotOutputSchema = z.object({ snapshotId: SnapshotIdSchema });
export type SnapshotOutput = z.infer<typeof SnapshotOutputSchema>;

export const RevertInputSchema = z.object({ snapshotId: SnapshotIdSchema });
export const RevertOutputSchema = z.object({ success: z.boolean() });
export type RevertInput = z.infer<typeof RevertInputSchema>;
export type RevertOutput = z.infer<typeof RevertOutputSchema>;

export const MineInputSchema = z.object({ blocks: z.number().int().positive() });
export const MineOutputSchema = z.object({ newBlockNumber: BlockNumberSchema });
export type MineInput = z.infer<typeof MineInputSchema>;
export type MineOutput = z.infer<typeof MineOutputSchema>;

export const ForkInputSchema = z.object({
  rpcUrl: z.url(),
  blockNumber: BlockNumberSchema.optional(),
});
export const ForkOutputSchema = z.object({
  rpcUrl: z.url(),
  chainId: ChainIdSchema,
});
export type ForkInput = z.infer<typeof ForkInputSchema>;
export type ForkOutput = z.infer<typeof ForkOutputSchema>;

/** All chain tools as a single registry — useful for the agent's tool loader. */
export const tools = {
  start_node: { input: StartNodeInputSchema, output: StartNodeOutputSchema },
  get_state: { input: GetStateInputSchema, output: GetStateOutputSchema },
  snapshot: { input: SnapshotInputSchema, output: SnapshotOutputSchema },
  revert: { input: RevertInputSchema, output: RevertOutputSchema },
  mine: { input: MineInputSchema, output: MineOutputSchema },
  fork: { input: ForkInputSchema, output: ForkOutputSchema },
} as const;
