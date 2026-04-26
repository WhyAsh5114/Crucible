/**
 * Tests for the chain MCP server factory.
 */

import { describe, it, expect } from 'bun:test';
import { createChainServer } from '../src/server.ts';

// ── Server factory ─────────────────────────────────────────────────────────

describe('createChainServer', () => {
  it('constructs a server without throwing', () => {
    expect(() => createChainServer('test-ws')).not.toThrow();
  });

  it('accepts a defaultForkRpcUrl option without throwing', () => {
    expect(() =>
      createChainServer('test-ws', { defaultForkRpcUrl: 'https://example.com/rpc' }),
    ).not.toThrow();
  });

  it('constructs a server with empty opts without throwing', () => {
    expect(() => createChainServer('test-ws', {})).not.toThrow();
  });
});
