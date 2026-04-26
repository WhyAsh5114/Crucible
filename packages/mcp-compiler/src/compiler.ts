/**
 * Hardhat-based Solidity compiler — compiles a single Solidity source file
 * using Hardhat v3's build system and returns typed artifact objects matching
 * @crucible/types CompiledContractSchema.
 *
 * Uses the same Hardhat dependency already present for chain management,
 * avoiding the solc-js CJS interop hacks.
 */

import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import { defineConfig } from 'hardhat/config';
import { FileBuildResultType } from 'hardhat/types/solidity';
import type { CompiledContract, CompilerMessage } from '@crucible/types';

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

interface RawArtifact {
  contractName: string;
  sourceName: string;
  abi: unknown[];
  bytecode: string;
  deployedBytecode: string;
}

/**
 * Compile a Solidity file at `absolutePath`.
 * @throws if the compilation emits errors.
 */
export async function compileSolidity(
  absolutePath: string,
  settings: SolcSettings = {},
): Promise<CompileResult> {
  const sourcesDir = dirname(absolutePath);

  const hre = await createHardhatRuntimeEnvironment(
    defineConfig({
      paths: { sources: sourcesDir },
      solidity: {
        version: '0.8.28',
        settings: {
          optimizer: settings['optimizer'] ?? { enabled: false, runs: 200 },
          evmVersion: settings['evmVersion'] ?? 'cancun',
        },
      },
    }),
  );

  const buildResult = await hre.solidity.build([absolutePath]);

  if (!hre.solidity.isSuccessfulBuildResult(buildResult)) {
    throw new Error(`Compilation of ${basename(absolutePath)} failed: build process error`);
  }

  const allErrors: CompilerMessage[] = [];
  const allWarnings: CompilerMessage[] = [];
  const artifactPaths: string[] = [];

  for (const [, result] of buildResult) {
    if (result.type === FileBuildResultType.BUILD_FAILURE) {
      for (const e of result.errors) {
        allErrors.push({
          severity: 'error',
          message: e.formattedMessage ?? e.message,
          ...(e.errorCode ? { errorCode: e.errorCode } : {}),
        });
      }
    } else if (result.type === FileBuildResultType.BUILD_SUCCESS) {
      for (const w of result.warnings) {
        allWarnings.push({
          severity: 'warning',
          message: w.formattedMessage ?? w.message,
          ...(w.errorCode ? { errorCode: w.errorCode } : {}),
        });
      }
      artifactPaths.push(...result.contractArtifactsGenerated);
    } else {
      // CACHE_HIT — artifacts already written; paths still need to be read
      artifactPaths.push(...result.contractArtifactsGenerated);
    }
  }

  if (allErrors.length > 0) {
    const summary = allErrors.map((e) => e.message).join('\n');
    throw new Error(`solc compilation failed:\n${summary}`);
  }

  const contracts: CompiledContract[] = await Promise.all(
    artifactPaths.map(async (artifactPath) => {
      const raw = JSON.parse(await readFile(artifactPath, 'utf8')) as RawArtifact;
      return {
        name: `${basename(raw.sourceName)}:${raw.contractName}`,
        abi: raw.abi as CompiledContract['abi'],
        bytecode: raw.bytecode as CompiledContract['bytecode'],
        deployedBytecode: raw.deployedBytecode as CompiledContract['deployedBytecode'],
      };
    }),
  );

  return { contracts, errors: [], warnings: allWarnings };
}
