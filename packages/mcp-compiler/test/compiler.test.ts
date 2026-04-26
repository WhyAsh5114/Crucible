/**
 * Integration tests for compileSolidity() against the Counter.sol fixture.
 *
 * These tests invoke the real solc-js binary and do not require any
 * external services.
 */

import { describe, it, expect } from 'bun:test';
import { resolve } from 'node:path';
import { compileSolidity } from '../src/compiler.ts';

const FIXTURE = resolve(import.meta.dir, 'fixtures/Counter.sol');

describe('compileSolidity — Counter.sol', () => {
  it('returns at least one contract', () => {
    const { contracts } = compileSolidity(FIXTURE);
    expect(contracts.length).toBeGreaterThan(0);
  });

  it('returns a fully-qualified contract name', () => {
    const { contracts } = compileSolidity(FIXTURE);
    expect(contracts[0]?.name).toBe('Counter.sol:Counter');
  });

  it('returns a non-empty ABI array', () => {
    const { contracts } = compileSolidity(FIXTURE);
    expect(Array.isArray(contracts[0]?.abi)).toBe(true);
    expect((contracts[0]?.abi ?? []).length).toBeGreaterThan(0);
  });

  it('returns 0x-prefixed bytecode', () => {
    const { contracts } = compileSolidity(FIXTURE);
    expect(contracts[0]?.bytecode.startsWith('0x')).toBe(true);
    expect(contracts[0]?.deployedBytecode.startsWith('0x')).toBe(true);
  });

  it('returns no errors for valid source', () => {
    const { errors } = compileSolidity(FIXTURE);
    expect(errors).toHaveLength(0);
  });

  it('includes the increment, decrement, and reset functions in the ABI', () => {
    const { contracts } = compileSolidity(FIXTURE);
    const abi = contracts[0]?.abi ?? [];
    const names = (abi as unknown as Array<{ name?: string }>)
      .filter((item) => item.name)
      .map((item) => item.name as string);
    expect(names).toContain('increment');
    expect(names).toContain('decrement');
    expect(names).toContain('reset');
  });

  it('throws for a non-existent path', () => {
    expect(() => compileSolidity('/does/not/exist.sol')).toThrow();
  });
});
