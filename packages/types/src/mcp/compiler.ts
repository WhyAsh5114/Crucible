/**
 * `compiler-mcp` — solc-js compilation against workspace files.
 */

import { z } from 'zod';
import { AbiSchema, CompiledContractSchema } from '../compiler.ts';
import { HexSchema } from '../primitives.ts';

export const CompileInputSchema = z.object({
  /** Workspace-relative path of the source file to compile. */
  sourcePath: z.string().min(1),
  /** Optional solc settings override. Opaque pass-through to solc-js. */
  settings: z.record(z.string(), z.unknown()).optional(),
});
export const CompileOutputSchema = z.object({
  contracts: z.array(CompiledContractSchema),
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
export const ListContractsOutputSchema = z.object({
  contracts: z.array(z.string().min(1)),
});
export type ListContractsOutput = z.infer<typeof ListContractsOutputSchema>;

export const tools = {
  compile: { input: CompileInputSchema, output: CompileOutputSchema },
  get_abi: { input: GetAbiInputSchema, output: GetAbiOutputSchema },
  get_bytecode: { input: GetBytecodeInputSchema, output: GetBytecodeOutputSchema },
  list_contracts: { input: ListContractsInputSchema, output: ListContractsOutputSchema },
} as const;
