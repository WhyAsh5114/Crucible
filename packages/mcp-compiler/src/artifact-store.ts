/**
 * In-memory artifact store — maps contract name → compiled artifact.
 *
 * A single process-level singleton holds the latest compilation results
 * so `get_abi`, `get_bytecode`, and `list_contracts` can serve cached data
 * without re-compiling on every call.
 *
 * Key format: fully-qualified solc name, e.g. "Counter.sol:Counter".
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompiledContract } from '@crucible/types';

const store = new Map<string, CompiledContract>();

/**
 * Tracks which contracts were produced by each source file so that recompiling
 * a file evicts its previous output before inserting the new one.
 * Key: workspace-relative source path (e.g. "contracts/Counter.sol"). Value: contract names.
 * Using the full relative path (not just basename) avoids collisions between
 * same-named files in different directories.
 */
const sourceFileMap = new Map<string, string[]>();

/**
 * Store compiled contracts, evicting any contracts previously produced by the
 * same source file when `sourceFile` is supplied.
 */
export function storeContracts(contracts: CompiledContract[], sourceFile?: string): void {
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
}

/** Return a single contract by its fully-qualified name, or `undefined`. */
export function getContract(name: string): CompiledContract | undefined {
  return store.get(name);
}

/**
 * Resolve a short name (e.g. "Counter") to a stored contract.
 * Prefers an exact match; falls back to suffix-matching "*.sol:Name".
 */
export function resolveContract(name: string): CompiledContract | undefined {
  // Exact match first
  const exact = store.get(name);
  if (exact) return exact;

  // Suffix match: "file.sol:ContractName"
  const suffix = `:${name}`;
  for (const [key, artifact] of store.entries()) {
    if (key.endsWith(suffix)) return artifact;
  }
  return undefined;
}

/** List all fully-qualified contract names in the cache. */
export function listContractNames(): string[] {
  return [...store.keys()];
}

/** Flush the entire cache (useful in tests). */
export function clearStore(): void {
  store.clear();
  sourceFileMap.clear();
}

/**
 * Write compiled artifacts to `{workspaceRoot}/.crucible/artifacts/`.
 *
 * One JSON file is written per contract. The filename is the fully-qualified
 * contract name with `:` replaced by `__` so it is filesystem-safe:
 * `Counter.sol:Counter` → `Counter.sol__Counter.json`.
 *
 * The directory is created if it does not already exist.
 */
export async function persistArtifacts(
  workspaceRoot: string,
  contracts: CompiledContract[],
): Promise<void> {
  const artifactsDir = join(workspaceRoot, '.crucible', 'artifacts');
  await mkdir(artifactsDir, { recursive: true });
  await Promise.all(
    contracts.map((c) => {
      const fileName = `${c.name.replace(':', '__')}.json`;
      return writeFile(join(artifactsDir, fileName), JSON.stringify(c, null, 2), 'utf8');
    }),
  );
}
