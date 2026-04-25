/**
 * Local Hardhat chain state observable by the agent and the UI.
 */

import { z } from 'zod';
import {
  AddressSchema,
  BigIntStringSchema,
  BlockNumberSchema,
  ChainIdSchema,
  SnapshotIdSchema,
} from './primitives.ts';

export const ChainStateSchema = z.object({
  chainId: ChainIdSchema,
  blockNumber: BlockNumberSchema,
  /** Current gas price in wei. Hardhat reports this even on its in-memory chain. */
  gasPrice: BigIntStringSchema,
  /** Pre-funded accounts available to the embedded dev wallet. */
  accounts: z.array(AddressSchema),
  /** True when the chain is forked from a public RPC. */
  isForked: z.boolean(),
  /** Block number at which the fork was pinned, when `isForked === true`. */
  forkBlock: BlockNumberSchema.optional(),
  /** Snapshot stack — the agent may push and pop these for revert-safe ops. */
  activeSnapshotIds: z.array(SnapshotIdSchema),
});
export type ChainState = z.infer<typeof ChainStateSchema>;
