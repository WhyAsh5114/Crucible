/**
 * Tests for the compiler MCP server factory.
 */

import { describe, it, expect } from 'bun:test';
import { createCompilerServer } from '../src/server.ts';

// ── Server factory ─────────────────────────────────────────────────────────

describe('createCompilerServer', () => {
  it('constructs a server without throwing', () => {
    expect(() => createCompilerServer({ workspaceRoot: '/tmp' })).not.toThrow();
  });
});
