/**
 * solc-js wrapper — compiles a single Solidity source file and returns
 * typed artifact objects matching @crucible/types CompiledContractSchema.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
// solc is a CommonJS module; import via createRequire for ESM compat.
import { createRequire } from 'node:module';
import type { CompiledContract, CompilerMessage } from '@crucible/types';

const _require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const solc = _require('solc') as any;

export interface SolcSettings {
  optimizer?: { enabled?: boolean; runs?: number };
  evmVersion?: string;
  [key: string]: unknown;
}

export interface CompileResult {
  contracts: CompiledContract[];
  errors: CompilerMessage[];
  warnings: CompilerMessage[];
}

/**
 * Compile a Solidity file at `absolutePath`.
 * @throws if solc emits compilation errors.
 */
export function compileSolidity(absolutePath: string, settings: SolcSettings = {}): CompileResult {
  const source = readFileSync(absolutePath, 'utf8');
  const fileName = basename(absolutePath);

  const solcInput = {
    language: 'Solidity',
    sources: {
      [fileName]: { content: source },
    },
    settings: {
      optimizer: { enabled: false, runs: 200 },
      evmVersion: 'cancun',
      ...settings,
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode', 'storageLayout'],
        },
      },
    },
  };

  const rawOutput = solc.compile(JSON.stringify(solcInput)) as string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const output = JSON.parse(rawOutput) as any;

  const allErrors: CompilerMessage[] = [];
  const allWarnings: CompilerMessage[] = [];

  if (output.errors) {
    for (const e of output.errors as Array<{
      severity: string;
      message: string;
      formattedMessage?: string;
      errorCode?: string;
    }>) {
      const msg: CompilerMessage = {
        severity: e.severity === 'error' ? 'error' : 'warning',
        message: e.formattedMessage ?? e.message,
        ...(e.errorCode ? { errorCode: e.errorCode } : {}),
      };
      if (msg.severity === 'error') allErrors.push(msg);
      else allWarnings.push(msg);
    }
  }

  if (allErrors.length > 0) {
    const summary = allErrors.map((e) => e.message).join('\n');
    throw new Error(`solc compilation failed:\n${summary}`);
  }

  const contracts: CompiledContract[] = [];

  const fileContracts = output.contracts?.[fileName] as
    | Record<
        string,
        {
          abi: unknown[];
          evm: {
            bytecode: { object: string };
            deployedBytecode: { object: string };
          };
          storageLayout?: unknown;
        }
      >
    | undefined;

  if (fileContracts) {
    for (const [name, artifact] of Object.entries(fileContracts)) {
      const bytecode = artifact.evm.bytecode.object;
      const deployedBytecode = artifact.evm.deployedBytecode.object;

      contracts.push({
        name: `${fileName}:${name}`,
        abi: artifact.abi as CompiledContract['abi'],
        bytecode: `0x${bytecode}`,
        deployedBytecode: `0x${deployedBytecode}`,
        ...(artifact.storageLayout !== undefined ? { storageLayout: artifact.storageLayout } : {}),
        ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
      });
    }
  }

  return { contracts, errors: allErrors, warnings: allWarnings };
}
