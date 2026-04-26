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
    const [c] = contracts;
    expect(c.name).toBe('Counter.sol:Counter');
  });

  it('returns a non-empty ABI array', () => {
    const { contracts } = compileSolidity(FIXTURE);
    const [c] = contracts;
    expect(Array.isArray(c.abi)).toBe(true);
    expect(c.abi.length).toBeGreaterThan(0);
  });

  it('returns 0x-prefixed bytecode', () => {
    const { contracts } = compileSolidity(FIXTURE);
    const [c] = contracts;
    expect(c.bytecode.startsWith('0x')).toBe(true);
    expect(c.deployedBytecode.startsWith('0x')).toBe(true);
  });

  it('returns no errors for valid source', () => {
    const { errors } = compileSolidity(FIXTURE);
    expect(errors).toHaveLength(0);
  });

  it('includes the increment, decrement, and reset functions in the ABI', () => {
    const { contracts } = compileSolidity(FIXTURE);
    const [c] = contracts;
    const names = (c.abi as Array<{ name?: string }>)
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
