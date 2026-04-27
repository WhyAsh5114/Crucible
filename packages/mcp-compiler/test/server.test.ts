/**
 * Tests for the compiler MCP server factory.
 */

import { describe, it, expect } from 'bun:test';
import { createCompilerServer } from '../src/server.ts';
import { CompileInputSchema } from '@crucible/types/mcp/compiler';

// ── Server factory ─────────────────────────────────────────────────────────

describe('createCompilerServer', () => {
  it('constructs a server without throwing', () => {
    expect(() => createCompilerServer({ workspaceRoot: '/tmp' })).not.toThrow();
  });
});

// ── CompileInputSchema ─────────────────────────────────────────────────────

describe('CompileInputSchema', () => {
  it('accepts sourcePath alone', () => {
    const result = CompileInputSchema.safeParse({ sourcePath: 'contracts/Counter.sol' });
    expect(result.success).toBe(true);
  });

  it('accepts sourcePath with optional settings', () => {
    const result = CompileInputSchema.safeParse({
      sourcePath: 'contracts/Counter.sol',
      settings: { optimizer: { enabled: true } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects when sourcePath is missing', () => {
    const result = CompileInputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects when sourcePath is empty', () => {
    const result = CompileInputSchema.safeParse({ sourcePath: '' });
    expect(result.success).toBe(false);
  });
});
