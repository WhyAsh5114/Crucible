/**
 * Smoke tests for the mcp-mesh MCP server factory.
 *
 * These tests construct the server without starting the AXL binary, mirroring
 * the pattern used in mcp-chain/test/server.test.ts.
 */

import { describe, it, expect } from 'bun:test';
import { AXLNodeManager } from '../src/node-manager.ts';
import { createMeshServer } from '../src/server.ts';

describe('createMeshServer', () => {
  it('constructs a server without throwing', () => {
    const manager = new AXLNodeManager('/tmp/crucible-test-ws');
    expect(() => createMeshServer(manager)).not.toThrow();
  });

  it('returns an object with a connect method (McpServer duck-type)', () => {
    const manager = new AXLNodeManager('/tmp/crucible-test-ws');
    const server = createMeshServer(manager);
    // McpServer exposes connect() to attach a transport
    expect(typeof server.connect).toBe('function');
  });
});
