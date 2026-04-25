/**
 * Local-deploy artifacts and EVM trace shapes.
 *
 * These types describe what the agent observes when it deploys and inspects
 * transactions on the local Hardhat chain. Public-chain executions go through
 * KeeperHub and are described in `./ship.ts`.
 */

import { z } from 'zod';
import {
  AddressSchema,
  AuditTrailIdSchema,
  BigIntStringSchema,
  BlockNumberSchema,
  ChainTargetSchema,
  HashSchema,
  HexSchema,
  TimestampMsSchema,
} from './primitives.ts';

/** A single decoded EVM call frame inside a trace tree. */
export const DecodedCallSchema = z.object({
  depth: z.number().int().nonnegative(),
  to: AddressSchema,
  /** ABI-decoded function signature, e.g. `transfer(address,uint256)`. */
  fn: z.string(),
  /** Decoded arguments. Shape varies per function. */
  args: z.array(z.unknown()),
  /** Decoded return value, or `null` if the call reverted or returned nothing. */
  result: z.unknown().nullable(),
  reverted: z.boolean(),
});
export type DecodedCall = z.infer<typeof DecodedCallSchema>;

export const StorageAccessSchema = z.object({
  contract: AddressSchema,
  /** 32-byte storage slot. */
  slot: HashSchema,
  /** Slot value as 32-byte hex. For writes, the post-transaction value. */
  value: HashSchema,
});
export type StorageAccess = z.infer<typeof StorageAccessSchema>;

export const DecodedEventSchema = z.object({
  contract: AddressSchema,
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
  /** Topic 0 = event signature hash. */
  signatureHash: HashSchema,
});
export type DecodedEvent = z.infer<typeof DecodedEventSchema>;

export const TxTraceSchema = z.object({
  txHash: HashSchema,
  decodedCalls: z.array(DecodedCallSchema),
  storageReads: z.array(StorageAccessSchema),
  storageWrites: z.array(StorageAccessSchema),
  events: z.array(DecodedEventSchema),
  /** Decoded revert reason string (after `Error(string)` / custom error decoding). */
  revertReason: z.string().optional(),
  gasUsed: BigIntStringSchema,
});
export type TxTrace = z.infer<typeof TxTraceSchema>;

/**
 * Persisted record of a single deployment. Used both for local deploys (where
 * `network === 'local'` and `keeperHubAuditId` is absent) and for shipped
 * deploys (where `network` is a public chain and `keeperHubAuditId` is set).
 */
export const DeploymentRecordSchema = z.object({
  contractName: z.string().min(1),
  address: AddressSchema,
  txHash: HashSchema,
  gasUsed: BigIntStringSchema,
  /** Constructor args as decoded JSON. */
  constructorArgs: z.array(z.unknown()),
  network: ChainTargetSchema,
  blockNumber: BlockNumberSchema,
  deployedAt: TimestampMsSchema,
  /** Present iff the deployment was shipped through KeeperHub. */
  keeperHubAuditId: AuditTrailIdSchema.optional(),
  /** Optional deployment bytecode pin for reproducibility. */
  deployedBytecode: HexSchema.optional(),
});
export type DeploymentRecord = z.infer<typeof DeploymentRecordSchema>;
