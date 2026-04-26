/**
 * Unit tests for the in-process artifact store.
 *
 * These tests cover the stale-eviction behaviour introduced to prevent
 * removed or renamed contracts from lingering in the cache.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { storeContracts, resolveContract, listContractNames, clearStore } from '../src/artifact-store.ts';
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
