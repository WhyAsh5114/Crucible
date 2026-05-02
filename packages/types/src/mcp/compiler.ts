/**
 * `compiler-mcp` — Hardhat-based Solidity compilation against workspace files.
 */

import { z } from 'zod';
import { AbiSchema, CompiledContractSchema, CompilerMessageSchema } from '../compiler.ts';
import { HexSchema } from '../primitives.ts';

export const CompileInputSchema = z.object({
  /** Workspace-relative path of the source file to compile (e.g. "contracts/Counter.sol"). */
  sourcePath: z.string().min(1),
  /** Optional compiler settings override (Hardhat-subset: version, optimizer, evmVersion). */
  settings: z.object({}).catchall(z.unknown()).optional(),
});
export const CompileOutputSchema = z.object({
  contracts: z.array(CompiledContractSchema),
  /** All warnings emitted across every contract in the file, deduplicated by message text. */
  warnings: z.array(CompilerMessageSchema).optional(),
});
export type CompileInput = z.infer<typeof CompileInputSchema>;
export type CompileOutput = z.infer<typeof CompileOutputSchema>;

export const GetAbiInputSchema = z.object({ contractName: z.string().min(1) });
export const GetAbiOutputSchema = z.object({ abi: AbiSchema });
export type GetAbiInput = z.infer<typeof GetAbiInputSchema>;
export type GetAbiOutput = z.infer<typeof GetAbiOutputSchema>;

export const GetBytecodeInputSchema = z.object({ contractName: z.string().min(1) });
export const GetBytecodeOutputSchema = z.object({
  bytecode: HexSchema,
  deployedBytecode: HexSchema,
});
export type GetBytecodeInput = z.infer<typeof GetBytecodeInputSchema>;
export type GetBytecodeOutput = z.infer<typeof GetBytecodeOutputSchema>;

export const ListContractsInputSchema = z.object({});

export const ContractSummarySchema = z.object({
  /** Fully-qualified name (e.g. "contracts/DemoVault.sol:DemoVault"). */
  name: z.string().min(1),
  /** Bare contract name (e.g. "DemoVault") — use this in deploy_local / call_contract. */
  shortName: z.string().min(1),
  /** ABI for the contract — use this directly with wallet.call_contract. */
  abi: AbiSchema,
  /**
   * All callable function signatures, canonicalised (e.g. ["deposit()", "withdraw(uint256)"]).
   * Convenience for the agent so it doesn't need to walk the ABI itself.
   */
  functions: z.array(z.string()),
});
export type ContractSummary = z.infer<typeof ContractSummarySchema>;

export const ListContractsOutputSchema = z.object({
  /** Bare contract names — kept for backwards compatibility. */
  contracts: z.array(z.string().min(1)),
  /** Rich per-contract metadata including ABI and function signatures. */
  summaries: z.array(ContractSummarySchema),
});
export type ListContractsOutput = z.infer<typeof ListContractsOutputSchema>;

export const tools = {
  compile: { input: CompileInputSchema, output: CompileOutputSchema },
  get_abi: { input: GetAbiInputSchema, output: GetAbiOutputSchema },
  get_bytecode: { input: GetBytecodeInputSchema, output: GetBytecodeOutputSchema },
  list_contracts: { input: ListContractsInputSchema, output: ListContractsOutputSchema },
} as const;
