/**
 * Unit tests for the chain MCP server in mock mode (MOCK_CHAIN=true).
 *
 * These tests cover all six tools without requiring a live Hardhat process.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  mockStartNode,
  mockGetState,
  mockSnapshot,
  mockRevert,
  mockMine,
  mockFork,
} from '../src/mock.ts';

// Reset mock module-level state between tests by re-importing a fresh copy.
// Bun's test runner executes each file in its own module scope, so we
// manipulate the exported state through the public API only.

describe('mockStartNode', () => {
  it('returns a valid rpc URL and chain ID', () => {
    const result = mockStartNode();
    expect(result.rpcUrl).toBe('http://127.0.0.1:8545');
    expect(result.chainId).toBe(31337);
  });
});

describe('mockGetState', () => {
  it('returns chain state with expected shape', () => {
    const state = mockGetState();
    expect(state.chainId).toBe(31337);
    expect(typeof state.blockNumber).toBe('number');
    expect(typeof state.gasPrice).toBe('string'); // BigInt wire format
    expect(state.isForked).toBe(false);
    expect(Array.isArray(state.accounts)).toBe(true);
    expect(state.accounts.length).toBeGreaterThan(0);
  });
});

describe('mockSnapshot / mockRevert', () => {
  it('snapshot returns a hex snapshot ID', () => {
    const { snapshotId } = mockSnapshot();
    expect(snapshotId.startsWith('0x')).toBe(true);
  });

  it('revert succeeds for a known snapshot ID', () => {
    const { snapshotId } = mockSnapshot();
    const { success } = mockRevert(snapshotId);
    expect(success).toBe(true);
  });

  it('revert fails for an unknown snapshot ID', () => {
    const { success } = mockRevert('0xdeadbeef');
    expect(success).toBe(false);
  });

  it('revert removes the snapshot from tracking', () => {
    const { snapshotId } = mockSnapshot();
    mockRevert(snapshotId);
    // A second revert on the same ID should fail
    const { success } = mockRevert(snapshotId);
    expect(success).toBe(false);
  });
});

describe('mockMine', () => {
  it('advances the block number by the requested count', () => {
    const before = mockGetState().blockNumber;
    const { newBlockNumber } = mockMine(3);
    expect(newBlockNumber).toBe(before + 3);
    expect(mockGetState().blockNumber).toBe(before + 3);
  });
});

describe('mockFork', () => {
  it('returns rpc URL and chain ID', () => {
    const result = mockFork();
    expect(result.rpcUrl).toBe('http://127.0.0.1:8545');
    expect(result.chainId).toBe(31337);
  });
});
