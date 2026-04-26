/**
 * `compiler-mcp` — Hardhat-based Solidity compilation against workspace files.
 */

import { z } from 'zod';
import { AbiSchema, CompiledContractSchema, CompilerMessageSchema } from '../compiler.ts';
import { HexSchema } from '../primitives.ts';

export const CompileInputSchema = z
  .object({
    /** Workspace-relative path of the source file to compile. Mutually exclusive with `source`. */
    sourcePath: z.string().min(1).optional(),
    /**
     * Inline Solidity source code to compile directly without a file on disk.
     * Mutually exclusive with `sourcePath`. Use `fileName` to control the source name
     * that appears in artifact identifiers (e.g. "MyToken.sol:MyToken").
     */
    source: z.string().min(1).optional(),
    /**
     * Filename to use when compiling inline `source` (must end in .sol).
     * Defaults to "Inline.sol". Ignored when `sourcePath` is provided.
     */
    fileName: z
      .string()
      .min(1)
      .regex(/\.sol$/, 'fileName must end in .sol')
      .optional(),
    /** Optional compiler settings override (Hardhat-subset: version, optimizer, evmVersion). */
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((d) => (d.sourcePath !== undefined) !== (d.source !== undefined), {
    message:
      'Provide exactly one of sourcePath (workspace file) or source (inline code), not both.',
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
