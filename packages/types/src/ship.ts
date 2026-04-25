/**
 * KeeperHub-mediated public-chain execution.
 *
 * Per docs/PLAN.md and docs/ARCHITECTURE.md, **every** transaction touching a
 * public chain must flow through KeeperHub. The local-deploy types in
 * `./deployer.ts` describe the local Hardhat path; the types here describe
 * the only sanctioned ship path.
 */

import { z } from 'zod';
import {
  AddressSchema,
  AuditTrailIdSchema,
  BigIntStringSchema,
  HashSchema,
  HexSchema,
} from './primitives.ts';

export const KeeperHubStatusSchema = z.enum(['pending', 'mined', 'confirmed', 'failed']);
export type KeeperHubStatus = z.infer<typeof KeeperHubStatusSchema>;

/**
 * Wire-safe `TransactionReceipt` view. We do not import viem's full receipt
 * type here because (a) it carries `bigint` fields that cannot cross the JSON
 * wire untransformed and (b) it would force every consumer of this type to
 * depend on viem at runtime. Backend code that needs the rich viem shape can
 * round-trip through this DTO.
 */
export const KeeperHubTxReceiptSchema = z.object({
  txHash: HashSchema,
  blockNumber: BigIntStringSchema,
  blockHash: HashSchema,
  from: AddressSchema,
  to: AddressSchema.nullable(),
  /** Set on contract-creation receipts. */
  contractAddress: AddressSchema.nullable(),
  gasUsed: BigIntStringSchema,
  cumulativeGasUsed: BigIntStringSchema,
  effectiveGasPrice: BigIntStringSchema,
  status: z.enum(['success', 'reverted']),
  logsBloom: HexSchema,
});
export type KeeperHubTxReceipt = z.infer<typeof KeeperHubTxReceiptSchema>;

export const KeeperHubExecutionSchema = z.object({
  txHash: HashSchema,
  receipt: KeeperHubTxReceiptSchema.nullable(),
  auditTrailId: AuditTrailIdSchema,
  retries: z.number().int().nonnegative(),
  status: KeeperHubStatusSchema,
});
export type KeeperHubExecution = z.infer<typeof KeeperHubExecutionSchema>;

/** A single tx in a ship bundle, in EIP-1559 shape (the only shape KeeperHub needs). */
export const ShipTxSchema = z.object({
  to: AddressSchema.nullable(),
  data: HexSchema,
  value: BigIntStringSchema,
  /** Optional gas hint. KeeperHub is the source of truth for final gas. */
  gas: BigIntStringSchema.optional(),
});
export type ShipTx = z.infer<typeof ShipTxSchema>;
