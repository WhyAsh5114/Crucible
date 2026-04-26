/**
 * In-memory artifact store — maps contract name → compiled artifact.
 *
 * Use `createArtifactStore()` to create an isolated store per workspace so
 * parallel workspaces never share compilation results.
 *
 * Key format: fully-qualified solc name, e.g. "Counter.sol:Counter".
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompiledContract } from '@crucible/types';

export interface ArtifactStore {
  /**
   * Store compiled contracts, evicting any contracts previously produced by
   * the same source file when `sourceFile` is supplied.
   */
  storeContracts(contracts: CompiledContract[], sourceFile?: string): void;
  /** Return a single contract by its fully-qualified name, or `undefined`. */
  getContract(name: string): CompiledContract | undefined;
  /**
   * Resolve a short name (e.g. "Counter") to a stored contract.
   * Prefers an exact match; falls back to suffix-matching "*.sol:Name".
   */
  resolveContract(name: string): CompiledContract | undefined;
  /** List all fully-qualified contract names in the cache. */
  listContractNames(): string[];
  /** Flush the entire cache (useful in tests). */
  clearStore(): void;
  /**
   * Write compiled artifacts to `{workspaceRoot}/.crucible/artifacts/`.
   *
   * One JSON file is written per contract. The filename is the fully-qualified
   * contract name with `:` replaced by `__` so it is filesystem-safe:
   * `Counter.sol:Counter` → `Counter.sol__Counter.json`.
   *
   * The directory is created if it does not already exist.
   */
  persistArtifacts(workspaceRoot: string, contracts: CompiledContract[]): Promise<void>;
}

/**
 * Create an isolated in-process artifact store. Each `createCompilerServer`
 * call (and each workspace process) should get its own store instance so
 * that parallel workspaces never share compilation results.
 */
export function createArtifactStore(): ArtifactStore {
  const store = new Map<string, CompiledContract>();

  /**
   * Tracks which contracts were produced by each source file so that
   * recompiling a file evicts its previous output before inserting the new
   * one. Key: workspace-relative source path. Value: contract names.
   */
  const sourceFileMap = new Map<string, string[]>();

  return {
    storeContracts(contracts: CompiledContract[], sourceFile?: string): void {
      if (sourceFile !== undefined) {
        const previous = sourceFileMap.get(sourceFile) ?? [];
        for (const name of previous) store.delete(name);
        sourceFileMap.set(
          sourceFile,
          contracts.map((c) => c.name),
        );
      }
      for (const contract of contracts) {
        store.set(contract.name, contract);
      }
    },

    getContract(name: string): CompiledContract | undefined {
      return store.get(name);
    },

    resolveContract(name: string): CompiledContract | undefined {
      const exact = store.get(name);
      if (exact) return exact;
      const suffix = `:${name}`;
      for (const [key, artifact] of store.entries()) {
        if (key.endsWith(suffix)) return artifact;
      }
      return undefined;
    },

    listContractNames(): string[] {
      return [...store.keys()];
    },

    clearStore(): void {
      store.clear();
      sourceFileMap.clear();
    },

    async persistArtifacts(workspaceRoot: string, contracts: CompiledContract[]): Promise<void> {
      const artifactsDir = join(workspaceRoot, '.crucible', 'artifacts');
      await mkdir(artifactsDir, { recursive: true });
      await Promise.all(
        contracts.map((c) => {
          const fileName = `${c.name.replace(/[:/\\]/g, '__')}.json`;
          return writeFile(join(artifactsDir, fileName), JSON.stringify(c, null, 2), 'utf8');
        }),
      );
    },
  };
}
