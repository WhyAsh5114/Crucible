/**
 * Integration tests for compileSolidity() against the Counter.sol fixture.
 *
 * These tests invoke the real Hardhat build system and do not require any
 * external services beyond the Hardhat solc download cache.
 */

import { describe, it, expect } from 'bun:test';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { compileSolidity } from '../src/compiler.ts';

const FIXTURE = resolve(import.meta.dir, 'fixtures/Counter.sol');

describe('compileSolidity — Counter.sol', () => {
  it('returns contracts for a fresh build from an uncached source path', async () => {
    const tempDir = await mkdtemp(join(resolve(import.meta.dir), '.tmp-crucible-sol-'));
    const tempFixture = join(tempDir, 'Counter.sol');

    try {
      const source = await readFile(FIXTURE, 'utf8');
      await writeFile(tempFixture, source, 'utf8');

      const { contracts } = await compileSolidity(tempFixture);
      expect(contracts.length).toBeGreaterThan(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('returns at least one contract', async () => {
    const { contracts } = await compileSolidity(FIXTURE);
    expect(contracts.length).toBeGreaterThan(0);
  });

  it('returns a fully-qualified contract name', async () => {
    const { contracts } = await compileSolidity(FIXTURE);
    // sourceName is the workspace-relative path emitted by Hardhat (e.g.
    // "packages/mcp-compiler/test/fixtures/Counter.sol:Counter").
    expect(contracts[0]?.name).toMatch(/Counter\.sol:Counter$/);
  });

  it('returns a non-empty ABI array', async () => {
    const { contracts } = await compileSolidity(FIXTURE);
    expect(Array.isArray(contracts[0]?.abi)).toBe(true);
    expect((contracts[0]?.abi ?? []).length).toBeGreaterThan(0);
  });

  it('returns 0x-prefixed bytecode', async () => {
    const { contracts } = await compileSolidity(FIXTURE);
    expect(contracts[0]?.bytecode.startsWith('0x')).toBe(true);
    expect(contracts[0]?.deployedBytecode.startsWith('0x')).toBe(true);
  });

  it('returns no errors for valid source', async () => {
    const { errors } = await compileSolidity(FIXTURE);
    expect(errors).toHaveLength(0);
  });

  it('includes the increment, decrement, and reset functions in the ABI', async () => {
    const { contracts } = await compileSolidity(FIXTURE);
    const abi = contracts[0]?.abi ?? [];
    const names = (abi as unknown as Array<{ name?: string }>)
      .filter((item) => item.name)
      .map((item) => item.name as string);
    expect(names).toContain('increment');
    expect(names).toContain('decrement');
    expect(names).toContain('reset');
  });
});
