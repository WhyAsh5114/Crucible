/**
 * Hardhat-based Solidity compiler — compiles a single Solidity source file
 * using Hardhat v3's build system and returns typed artifact objects matching
 * @crucible/types CompiledContractSchema.
 *
 * Uses the same Hardhat dependency already present for chain management,
 * avoiding the solc-js CJS interop hacks.
 */

import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { createHardhatRuntimeEnvironment } from 'hardhat/hre';
import { defineConfig } from 'hardhat/config';
import { FileBuildResultType } from 'hardhat/types/solidity';
import type { CompiledContract, CompilerMessage } from '@crucible/types';

export interface SolcSettings {
  version?: string | undefined;
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

  const solcVersion = settings.version ?? '0.8.28';
  const hre = await createHardhatRuntimeEnvironment(
    defineConfig({
      paths: { sources: sourcesDir },
      solidity: {
        version: solcVersion,
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
      // Hardhat v3 has a path-key mismatch bug: artifactsPerFile is keyed by
      // root.fsPath (absolute) but looked up via userSourceName (relative from
      // cwd), so contractArtifactsGenerated is empty on the first build.
      // Fall back to scanning the artifacts directory directly.
      if (result.contractArtifactsGenerated.length > 0) {
        artifactPaths.push(...result.contractArtifactsGenerated);
      } else {
        const rel = relative(process.cwd(), absolutePath);
        const artifactDir = join(hre.config.paths.artifacts, rel);
        try {
          const files = await readdir(artifactDir);
          artifactPaths.push(
            ...files
              .filter((f) => f.endsWith('.json') && f !== 'artifacts.d.ts')
              .map((f) => join(artifactDir, f)),
          );
        } catch {
          // directory may not exist if the file had no contracts
        }
      }
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
