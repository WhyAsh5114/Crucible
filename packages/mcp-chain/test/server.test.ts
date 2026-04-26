/**
 * Tests for the chain MCP server factory.
 */

import { describe, it, expect } from 'bun:test';
import { createChainServer } from '../src/server.ts';

// ── Server factory ─────────────────────────────────────────────────────────

describe('createChainServer', () => {
  it('constructs a server without throwing', () => {
    expect(() => createChainServer()).not.toThrow();
  });
});
