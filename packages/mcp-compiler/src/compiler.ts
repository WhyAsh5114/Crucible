/**
 * Hardhat-based Solidity compiler — compiles a single Solidity source file
 * using Hardhat v3's build system and returns typed artifact objects matching
 * @crucible/types CompiledContractSchema.
 *
 * Uses the same Hardhat dependency already present for chain management,
 * avoiding the solc-js CJS interop hacks.
 */

import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
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

function isPathInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function toRelativeIfInside(root: string, absolutePath: string): string | undefined {
  const rel = relative(root, absolutePath);
  if (rel === '' || rel === '.') {
    return basename(absolutePath);
  }
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return undefined;
  }
  return rel;
}

function isArtifactJson(fileName: string): boolean {
  return fileName.endsWith('.json') && !fileName.endsWith('.dbg.json');
}

async function listArtifactFilesInDir(artifactDir: string): Promise<string[]> {
  try {
    const files = await readdir(artifactDir);
    return files
      .filter((fileName) => isArtifactJson(fileName))
      .map((fileName) => join(artifactDir, fileName));
  } catch {
    // Directory may not exist if the file had no contracts.
    return [];
  }
}

async function scanArtifactsBySourceName(
  artifactsRoot: string,
  absoluteSourcePath: string,
  projectRoot: string,
  sourceRoots: string[],
): Promise<string[]> {
  const queue = [artifactsRoot];
  const matches: string[] = [];

  while (queue.length > 0) {
    const dir = queue.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryName = entry.name.toString();
      const entryPath = join(dir, entryName);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (!entry.isFile() || !isArtifactJson(entryName)) {
        continue;
      }

      try {
        const parsed = JSON.parse(await readFile(entryPath, 'utf8')) as Partial<RawArtifact>;
        if (typeof parsed.sourceName !== 'string') {
          continue;
        }

        const normalizedSourceName = parsed.sourceName.replace(/\\/g, '/');
        const candidates = [
          resolve(projectRoot, normalizedSourceName),
          ...sourceRoots.map((root) => resolve(root, normalizedSourceName)),
        ];

        if (candidates.some((candidate) => candidate === absoluteSourcePath)) {
          matches.push(entryPath);
        }
      } catch {
        // Skip non-artifact JSON files like build-info payloads.
      }
    }
  }

  return matches;
}

/**
 * Compile a Solidity file at `absolutePath`.
 * @throws if the compilation emits errors.
 */
export async function compileSolidity(
  absolutePath: string,
  settings: SolcSettings = {},
): Promise<CompileResult> {
  const normalizedAbsolutePath = resolve(absolutePath);
  const sourcesDir = dirname(normalizedAbsolutePath);

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
    undefined,
    sourcesDir, // projectRoot — prevents Hardhat from defaulting to process.cwd()
  );

  const buildResult = await hre.solidity.build([normalizedAbsolutePath]);

  if (!hre.solidity.isSuccessfulBuildResult(buildResult)) {
    throw new Error(`Compilation of ${basename(absolutePath)} failed: build process error`);
  }

  const allErrors: CompilerMessage[] = [];
  const allWarnings: CompilerMessage[] = [];
  const artifactPaths: string[] = [];
  const artifactsRoot = resolve(hre.config.paths.artifacts);
  const projectRoot = resolve(hre.config.paths.root);
  const sourceRoots = hre.config.paths.sources.solidity.map((sourceRoot) => resolve(sourceRoot));

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
        const relCandidates = new Set<string>();

        const fromProjectRoot = toRelativeIfInside(projectRoot, normalizedAbsolutePath);
        if (fromProjectRoot !== undefined) {
          relCandidates.add(fromProjectRoot);
        }

        for (const sourceRoot of sourceRoots) {
          const fromSourceRoot = toRelativeIfInside(sourceRoot, normalizedAbsolutePath);
          if (fromSourceRoot !== undefined) {
            relCandidates.add(fromSourceRoot);
          }
        }

        relCandidates.add(basename(normalizedAbsolutePath));

        const discovered = new Set<string>();
        for (const relSourcePath of relCandidates) {
          const artifactDir = resolve(artifactsRoot, relSourcePath);
          if (!isPathInside(artifactsRoot, artifactDir)) {
            continue;
          }

          const files = await listArtifactFilesInDir(artifactDir);
          for (const file of files) {
            discovered.add(file);
          }
        }

        if (discovered.size === 0) {
          const scanned = await scanArtifactsBySourceName(
            artifactsRoot,
            normalizedAbsolutePath,
            projectRoot,
            sourceRoots,
          );
          for (const file of scanned) {
            discovered.add(file);
          }
        }

        if (discovered.size > 0) {
          artifactPaths.push(...discovered);
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

  const uniqueArtifactPaths = [...new Set(artifactPaths)];

  const contracts: CompiledContract[] = await Promise.all(
    uniqueArtifactPaths.map(async (artifactPath) => {
      const raw = JSON.parse(await readFile(artifactPath, 'utf8')) as RawArtifact;
      return {
        // Preserve the full relative source path (normalise to forward slashes)
        // so names match the "contracts/Foo.sol:Foo" convention and avoid
        // collisions between same-basename files in different directories.
        name: `${raw.sourceName.replace(/\\/g, '/')}:${raw.contractName}`,
        abi: raw.abi as CompiledContract['abi'],
        bytecode: raw.bytecode as CompiledContract['bytecode'],
        deployedBytecode: raw.deployedBytecode as CompiledContract['deployedBytecode'],
      };
    }),
  );

  return { contracts, errors: [], warnings: allWarnings };
}
