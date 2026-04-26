/**
 * Tests for the chain MCP server factory and mock output schema conformance.
 *
 * Covers two things the mock.test.ts unit tests cannot:
 *  1. That `createChainServer()` constructs a valid McpServer without errors.
 *  2. That every mock function's return value satisfies the corresponding
 *     output schema from @crucible/types/mcp/chain, catching contract drift
 *     between the mock and the type definitions.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { createChainServer } from '../src/server.ts';
import {
  StartNodeOutputSchema,
  GetStateOutputSchema,
  SnapshotOutputSchema,
  RevertOutputSchema,
  MineOutputSchema,
  ForkOutputSchema,
} from '@crucible/types/mcp/chain';
import {
  mockStartNode,
  mockGetState,
  mockSnapshot,
  mockRevert,
  mockMine,
  mockFork,
  resetMockState,
} from '../src/mock.ts';

beforeEach(() => {
  resetMockState();
});

// ── Server factory ─────────────────────────────────────────────────────────

describe('createChainServer', () => {
  it('constructs a server without throwing', () => {
    expect(() => createChainServer()).not.toThrow();
  });
});

// ── Mock output schema conformance ────────────────────────────────────────
//
// Each test calls the mock function and validates the result against the
// Zod output schema exported from @crucible/types/mcp/chain.  If a mock
// drifts from the contract, safeParse returns success: false and the
// test fails with a clear Zod error in result.error.

describe('mock output — schema conformance', () => {
  it('mockStartNode conforms to StartNodeOutputSchema', () => {
    const result = StartNodeOutputSchema.safeParse(mockStartNode());
    expect(result.success).toBe(true);
  });

  it('mockGetState conforms to GetStateOutputSchema', () => {
    const result = GetStateOutputSchema.safeParse(mockGetState());
    if (!result.success) {
      throw new Error(`Schema mismatch: ${JSON.stringify(result.error.issues, null, 2)}`);
    }
    expect(result.success).toBe(true);
  });

  it('mockSnapshot conforms to SnapshotOutputSchema', () => {
    const result = SnapshotOutputSchema.safeParse(mockSnapshot());
    expect(result.success).toBe(true);
  });

  it('mockRevert (success=true) conforms to RevertOutputSchema', () => {
    const { snapshotId } = mockSnapshot();
    const result = RevertOutputSchema.safeParse(mockRevert(snapshotId));
    expect(result.success).toBe(true);
  });

  it('mockRevert (success=false) conforms to RevertOutputSchema', () => {
    const result = RevertOutputSchema.safeParse(mockRevert('0xdeadbeef'));
    expect(result.success).toBe(true);
  });

  it('mockMine conforms to MineOutputSchema', () => {
    const result = MineOutputSchema.safeParse(mockMine(5));
    expect(result.success).toBe(true);
  });

  it('mockFork conforms to ForkOutputSchema', () => {
    const result = ForkOutputSchema.safeParse(mockFork());
    expect(result.success).toBe(true);
  });

  it('mockGetState after mining reflects updated blockNumber', () => {
    mockMine(7);
    const state = mockGetState();
    expect(state.blockNumber).toBe(7);

    const result = GetStateOutputSchema.safeParse(state);
    expect(result.success).toBe(true);
  });

  it('mockGetState after snapshot includes snapshotId in activeSnapshotIds', () => {
    const { snapshotId } = mockSnapshot();
    const state = mockGetState();
    expect(state.activeSnapshotIds).toContain(snapshotId);

    const result = GetStateOutputSchema.safeParse(state);
    expect(result.success).toBe(true);
  });
});
