/**
 * Solidity (and forward-looking Vyper) compiler artifacts.
 */

import { z } from 'zod';
import { HexSchema } from './primitives.ts';
import type { Abi, AbiFunction } from 'viem';
import { toFunctionSignature } from 'viem';

export const CompilerSeveritySchema = z.enum(['error', 'warning']);
export type CompilerSeverity = z.infer<typeof CompilerSeveritySchema>;

export const CompilerMessageSchema = z.object({
  severity: CompilerSeveritySchema,
  message: z.string(),
  /** Free-form source location (e.g. `contracts/Vault.sol:42:5`). Optional
   *  because some compiler errors are file-level. */
  location: z.string().optional(),
  /** solc-style error code, when available. */
  errorCode: z.string().optional(),
});
export type CompilerMessage = z.infer<typeof CompilerMessageSchema>;

/**
 * viem's `Abi` is a deeply-typed structural union. Validating its full shape
 * at runtime here would duplicate viem's type system poorly. We accept any
 * array (Solidity ABIs are JSON arrays of objects) and trust viem at the
 * static-type boundary. Callers that need richer validation should use
 * `parseAbi` / `parseAbiItem` from viem directly.
 */
export const AbiSchema: z.ZodType<Abi> = z.array(z.unknown()) as unknown as z.ZodType<Abi>;

export const CompiledContractSchema = z.object({
  /** Fully-qualified contract name as emitted by solc, e.g. `contracts/Vault.sol:Vault`. */
  name: z.string().min(1),
  abi: AbiSchema,
  bytecode: HexSchema,
  deployedBytecode: HexSchema,
  /** solc storage layout, when emitted. Opaque pass-through. */
  storageLayout: z.unknown().optional(),
  warnings: z.array(CompilerMessageSchema).optional(),
});
export type CompiledContract = z.infer<typeof CompiledContractSchema>;

/**
 * Extract canonical function signatures (e.g. "transfer(address,uint256)") from an ABI.
 * Used to give the agent a quick summary of what's callable on a contract.
 */
export function abiFunctionSignatures(abi: Abi): string[] {
  return abi
    .filter((item): item is AbiFunction => (item as AbiFunction).type === 'function')
    .map((item) => toFunctionSignature(item));
}
