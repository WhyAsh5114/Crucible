/**
 * Tests for the compiler MCP server factory and mock output schema conformance.
 *
 * Covers two things the compiler.test.ts and artifact-store.test.ts cannot:
 *  1. That `createCompilerServer()` constructs a valid McpServer without errors.
 *  2. That every mock function's return value satisfies the corresponding
 *     output schema from @crucible/types/mcp/compiler, catching contract drift
 *     between the mock and the type definitions.
 */

import { describe, it, expect } from 'bun:test';
import { createCompilerServer } from '../src/server.ts';
import {
  CompileOutputSchema,
  GetAbiOutputSchema,
  GetBytecodeOutputSchema,
  ListContractsOutputSchema,
} from '@crucible/types/mcp/compiler';
import { mockCompile, mockGetAbi, mockGetBytecode, mockListContracts } from '../src/mock.ts';

// ── Server factory ─────────────────────────────────────────────────────────

describe('createCompilerServer', () => {
  it('constructs a server without throwing', () => {
    expect(() => createCompilerServer({ workspaceRoot: '/tmp' })).not.toThrow();
  });
});

// ── Mock output schema conformance ────────────────────────────────────────
//
// Each test calls the mock function and validates the result against the
// Zod output schema exported from @crucible/types/mcp/compiler.  If a mock
// drifts from the contract, safeParse returns success: false and the
// test fails with a clear Zod error in result.error.

describe('mock output — schema conformance', () => {
  it('mockCompile conforms to CompileOutputSchema', () => {
    const result = CompileOutputSchema.safeParse(mockCompile('Counter.sol'));
    if (!result.success) {
      throw new Error(`Schema mismatch: ${JSON.stringify(result.error.issues, null, 2)}`);
    }
    expect(result.success).toBe(true);
  });

  it('mockCompile derives contract name from sourcePath', () => {
    const { contracts } = mockCompile('contracts/Vault.sol');
    expect(contracts[0]?.name).toBe('Vault.sol:Vault');
  });

  it('mockCompile with a bare filename derives name correctly', () => {
    const { contracts } = mockCompile('Token.sol');
    expect(contracts[0]?.name).toBe('Token.sol:Token');
  });

  it('mockGetAbi conforms to GetAbiOutputSchema', () => {
    const result = GetAbiOutputSchema.safeParse(mockGetAbi());
    if (!result.success) {
      throw new Error(`Schema mismatch: ${JSON.stringify(result.error.issues, null, 2)}`);
    }
    expect(result.success).toBe(true);
  });

  it('mockGetAbi returns a non-empty ABI array', () => {
    const { abi } = mockGetAbi();
    expect(Array.isArray(abi)).toBe(true);
    expect((abi as unknown[]).length).toBeGreaterThan(0);
  });

  it('mockGetBytecode conforms to GetBytecodeOutputSchema', () => {
    const result = GetBytecodeOutputSchema.safeParse(mockGetBytecode());
    if (!result.success) {
      throw new Error(`Schema mismatch: ${JSON.stringify(result.error.issues, null, 2)}`);
    }
    expect(result.success).toBe(true);
  });

  it('mockGetBytecode returns 0x-prefixed strings', () => {
    const { bytecode, deployedBytecode } = mockGetBytecode();
    expect(bytecode.startsWith('0x')).toBe(true);
    expect(deployedBytecode.startsWith('0x')).toBe(true);
  });

  it('mockListContracts conforms to ListContractsOutputSchema', () => {
    const result = ListContractsOutputSchema.safeParse(mockListContracts());
    if (!result.success) {
      throw new Error(`Schema mismatch: ${JSON.stringify(result.error.issues, null, 2)}`);
    }
    expect(result.success).toBe(true);
  });

  it('mockListContracts returns at least one contract name', () => {
    const { contracts } = mockListContracts();
    expect(contracts.length).toBeGreaterThan(0);
  });
});
