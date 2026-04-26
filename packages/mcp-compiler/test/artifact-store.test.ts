/**
 * Unit tests for the in-process artifact store.
 *
 * These tests cover the stale-eviction behaviour introduced to prevent
 * removed or renamed contracts from lingering in the cache.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  storeContracts,
  resolveContract,
  listContractNames,
  clearStore,
  persistArtifacts,
} from '../src/artifact-store.ts';
import type { CompiledContract } from '@crucible/types';

function makeContract(name: string): CompiledContract {
  return {
    name,
    abi: [],
    bytecode: '0x',
    deployedBytecode: '0x',
  };
}

beforeEach(() => {
  clearStore();
});

describe('storeContracts — basic storage', () => {
  it('stores contracts by their fully-qualified name', () => {
    storeContracts([makeContract('Foo.sol:Foo')]);
    expect(resolveContract('Foo.sol:Foo')).toBeDefined();
  });

  it('resolves by short name via suffix match', () => {
    storeContracts([makeContract('Foo.sol:Foo')]);
    expect(resolveContract('Foo')).toBeDefined();
  });

  it('returns undefined for unknown contracts', () => {
    expect(resolveContract('Unknown')).toBeUndefined();
  });
});

describe('storeContracts — stale eviction', () => {
  it('evicts old contracts when the same source file is recompiled', () => {
    storeContracts([makeContract('Foo.sol:Foo'), makeContract('Foo.sol:Bar')], 'Foo.sol');
    expect(listContractNames()).toHaveLength(2);

    // Recompile: Bar was removed, only Foo remains
    storeContracts([makeContract('Foo.sol:Foo')], 'Foo.sol');
    expect(listContractNames()).toHaveLength(1);
    expect(resolveContract('Bar')).toBeUndefined();
  });

  it('keeps contracts from other source files when recompiling one file', () => {
    storeContracts([makeContract('A.sol:A')], 'A.sol');
    storeContracts([makeContract('B.sol:B')], 'B.sol');

    // Recompile A — B should be untouched
    storeContracts([makeContract('A.sol:A2')], 'A.sol');
    expect(resolveContract('B')).toBeDefined();
    expect(resolveContract('A')).toBeUndefined();
    expect(resolveContract('A2')).toBeDefined();
  });

  it('accumulates across files when no sourceFile is provided', () => {
    storeContracts([makeContract('X.sol:X')]);
    storeContracts([makeContract('Y.sol:Y')]);
    expect(listContractNames()).toHaveLength(2);
  });
});

describe('listContractNames', () => {
  it('returns an empty array when the store is empty', () => {
    expect(listContractNames()).toHaveLength(0);
  });

  it('returns all stored names', () => {
    storeContracts([makeContract('A.sol:A'), makeContract('A.sol:B')], 'A.sol');
    const names = listContractNames();
    expect(names).toContain('A.sol:A');
    expect(names).toContain('A.sol:B');
  });
});

// ── persistArtifacts ───────────────────────────────────────────────────────

describe('persistArtifacts', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'crucible-artifacts-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writes one JSON file per contract under .crucible/artifacts/', async () => {
    await persistArtifacts(tmpDir, [makeContract('Counter.sol:Counter')]);

    const filePath = join(tmpDir, '.crucible', 'artifacts', 'Counter.sol__Counter.json');
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as { name: string };
    expect(parsed.name).toBe('Counter.sol:Counter');
  });

  it('replaces the colon with double-underscore in the filename', async () => {
    await persistArtifacts(tmpDir, [makeContract('Vault.sol:Vault')]);

    const filePath = join(tmpDir, '.crucible', 'artifacts', 'Vault.sol__Vault.json');
    const raw = await readFile(filePath, 'utf8');
    expect(JSON.parse(raw)).toMatchObject({ name: 'Vault.sol:Vault' });
  });

  it('creates the artifacts directory when it does not already exist', async () => {
    // tmpDir is a fresh directory — .crucible/artifacts/ does not exist
    await expect(persistArtifacts(tmpDir, [makeContract('A.sol:A')])).resolves.toBeUndefined();
  });

  it('writes multiple contracts in a single call', async () => {
    const contracts = [makeContract('A.sol:A'), makeContract('A.sol:B')];
    await persistArtifacts(tmpDir, contracts);

    const aPath = join(tmpDir, '.crucible', 'artifacts', 'A.sol__A.json');
    const bPath = join(tmpDir, '.crucible', 'artifacts', 'A.sol__B.json');
    await expect(readFile(aPath, 'utf8')).resolves.toBeDefined();
    await expect(readFile(bPath, 'utf8')).resolves.toBeDefined();
  });

  it('round-trips abi, bytecode, and deployedBytecode fields', async () => {
    const contract: ReturnType<typeof makeContract> & {
      bytecode: string;
      deployedBytecode: string;
    } = {
      ...makeContract('Token.sol:Token'),
      bytecode: '0x1234',
      deployedBytecode: '0x5678',
    };
    await persistArtifacts(tmpDir, [contract]);

    const filePath = join(tmpDir, '.crucible', 'artifacts', 'Token.sol__Token.json');
    const parsed = JSON.parse(await readFile(filePath, 'utf8')) as {
      bytecode: string;
      deployedBytecode: string;
    };
    expect(parsed.bytecode).toBe('0x1234');
    expect(parsed.deployedBytecode).toBe('0x5678');
  });
});
