/**
 * Foundation primitives: branded IDs, hex/address/hash validators, chain targets,
 * and a wire-safe bigint encoding (string in JSON, `bigint` at the type level).
 *
 * Every other module in `@crucible/types` builds on these. Nothing here imports
 * from another module in the package.
 */

import { z } from 'zod';
import type { Address, Hash, Hex } from 'viem';

// -----------------------------------------------------------------------------
// Hex primitives — runtime regex validators that match viem's branded types.
// -----------------------------------------------------------------------------

/** Lowercase 20-byte EVM address. We do not enforce checksum here; viem's
 *  `getAddress` is the canonical normalizer for that. */
export const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/u, 'Expected a 0x-prefixed 20-byte hex address')
  .transform((v) => v as Address);

/** 32-byte hash (tx hash, block hash, storage slot, etc.). */
export const HashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/u, 'Expected a 0x-prefixed 32-byte hex hash')
  .transform((v) => v as Hash);

/** Arbitrary-length hex blob (bytecode, calldata, signature). Even hex digits required. */
export const HexSchema = z
  .string()
  .regex(/^0x([0-9a-fA-F]{2})*$/u, 'Expected a 0x-prefixed even-length hex string')
  .transform((v) => v as Hex);

// -----------------------------------------------------------------------------
// Wire-safe bigint.
//
// JSON cannot represent values larger than 2^53 - 1, so any uint256-shaped
// quantity (gas, wei, balance) crosses the wire as a decimal string and is
// parsed into a real `bigint` on the receiving side.
// -----------------------------------------------------------------------------

const DECIMAL_UINT_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

// Intentionally no `.transform()` — keeps the value as a `string` so it
// remains JSON-serialisable.  Callers that need an actual `bigint` (e.g.
// service code that passes the value to `toHexQuantity`) should call
// `BigInt(value)` themselves.  The schema is used as the input/output type
// for MCP tool schemas fed to the Vercel AI SDK; the SDK internally calls
// `JSON.stringify` on parsed tool-call arguments, so `bigint` values would
// throw "JSON.stringify cannot serialize BigInt".
export const BigIntStringSchema = z
  .string()
  .regex(DECIMAL_UINT_PATTERN, 'Expected a non-negative decimal integer string');

/** Helper for producers — stringify a bigint for wire transport. */
export function encodeBigInt(value: bigint): string {
  if (value < 0n) throw new RangeError('BigIntStringSchema only accepts non-negative integers');
  return value.toString(10);
}

// -----------------------------------------------------------------------------
// Branded identifiers.
//
// Each ID is structurally a non-empty string but carries a unique brand so the
// type system rejects, e.g., passing a `WorkspaceId` where a `RuntimeId` is
// expected.
// -----------------------------------------------------------------------------

const nonEmpty = z.string().min(1);

export const WorkspaceIdSchema = nonEmpty
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/u, 'Workspace IDs must be lowercase slug-safe')
  .brand<'WorkspaceId'>();
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;

export const RuntimeIdSchema = nonEmpty.brand<'RuntimeId'>();
export type RuntimeId = z.infer<typeof RuntimeIdSchema>;

export const StreamIdSchema = nonEmpty.brand<'StreamId'>();
export type StreamId = z.infer<typeof StreamIdSchema>;

export const TerminalSessionIdSchema = nonEmpty.brand<'TerminalSessionId'>();
export type TerminalSessionId = z.infer<typeof TerminalSessionIdSchema>;

export const CallIdSchema = nonEmpty.brand<'CallId'>();
export type CallId = z.infer<typeof CallIdSchema>;

export const SnapshotIdSchema = nonEmpty.brand<'SnapshotId'>();
export type SnapshotId = z.infer<typeof SnapshotIdSchema>;

export const PatternIdSchema = nonEmpty.brand<'PatternId'>();
export type PatternId = z.infer<typeof PatternIdSchema>;

export const HelpRequestIdSchema = nonEmpty.brand<'HelpRequestId'>();
export type HelpRequestId = z.infer<typeof HelpRequestIdSchema>;

export const PeerIdSchema = nonEmpty.brand<'PeerId'>();
export type PeerId = z.infer<typeof PeerIdSchema>;

export const NodeIdSchema = nonEmpty.brand<'NodeId'>();
export type NodeId = z.infer<typeof NodeIdSchema>;

export const AuditTrailIdSchema = nonEmpty.brand<'AuditTrailId'>();
export type AuditTrailId = z.infer<typeof AuditTrailIdSchema>;

export const InferenceReceiptIdSchema = nonEmpty.brand<'InferenceReceiptId'>();
export type InferenceReceiptId = z.infer<typeof InferenceReceiptIdSchema>;

// -----------------------------------------------------------------------------
// Chain targets.
//
// `local` is the per-workspace Hardhat node. Public chains are the only valid
// targets for KeeperHub Ship. Mainnet is a non-goal for the hackathon (see
// docs/PLAN.md), but the type accepts it so the contract is forward-compatible.
// -----------------------------------------------------------------------------

export const PublicChainTargetSchema = z.enum(['sepolia', 'base-sepolia', 'mainnet']);
export type PublicChainTarget = z.infer<typeof PublicChainTargetSchema>;

export const ChainTargetSchema = z.enum(['local', 'sepolia', 'base-sepolia', 'mainnet']);
export type ChainTarget = z.infer<typeof ChainTargetSchema>;

// -----------------------------------------------------------------------------
// Common scalar shapes.
// -----------------------------------------------------------------------------

/** Unix timestamp in milliseconds. */
export const TimestampMsSchema = z.number().int().nonnegative();

/** Non-negative block number. EVM block numbers stay safely within `number`
 *  for the lifetime of any plausible Crucible workspace. */
export const BlockNumberSchema = z.number().int().nonnegative();

/** Chain ID as a positive integer (matches viem's `chainId`). */
export const ChainIdSchema = z.number().int().positive();

/** Loopback TCP port for an internal MCP service. */
export const PortSchema = z.number().int().min(1024).max(65535);

/** Re-export viem's branded primitives for downstream consumers so they get
 *  one consistent type set without needing to depend on viem directly. */
export type { Address, Hash, Hex } from 'viem';
