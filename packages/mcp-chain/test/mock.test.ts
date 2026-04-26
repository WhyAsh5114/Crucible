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
  resetMockState,
} from '../src/mock.ts';

// Reset all mock module-level state before every test for full isolation.
beforeEach(() => {
  resetMockState();
});

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

  it('reverting to an earlier snapshot invalidates all subsequent ones', () => {
    const { snapshotId: first } = mockSnapshot();
    const { snapshotId: second } = mockSnapshot();
    const { snapshotId: third } = mockSnapshot();

    // Revert to first — EVM semantics: first is consumed, second and third are invalid
    const { success } = mockRevert(first);
    expect(success).toBe(true);

    expect(mockRevert(second).success).toBe(false);
    expect(mockRevert(third).success).toBe(false);
  });

  it('reverting to a later snapshot keeps earlier snapshots usable', () => {
    const { snapshotId: first } = mockSnapshot();
    const { snapshotId: second } = mockSnapshot();

    // Revert to second — first was taken before second, so it should still be valid
    mockRevert(second);

    expect(mockRevert(first).success).toBe(true);
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
  it('sets isForked to true in subsequent get_state', () => {
    expect(mockGetState().isForked).toBe(false);
    mockFork();
    expect(mockGetState().isForked).toBe(true);
  });

  it('clears active snapshots on fork', () => {
    mockSnapshot();
    mockSnapshot();
    expect(mockGetState().activeSnapshotIds).toHaveLength(2);
    mockFork();
    expect(mockGetState().activeSnapshotIds).toHaveLength(0);
  });

  it('records forkBlock when a block number is provided', () => {
    mockFork(12345678);
    const state = mockGetState();
    expect(state.forkBlock).toBe(12345678);
  });

  it('clears forkBlock when forking to latest (no blockNumber)', () => {
    mockFork(12345678);
    mockFork(); // fork to latest
    expect(mockGetState().forkBlock).toBeUndefined();
  });
});

describe('mockFork', () => {
  it('returns rpc URL and chain ID', () => {
    const result = mockFork();
    expect(result.rpcUrl).toBe('http://127.0.0.1:8545');
    expect(result.chainId).toBe(31337);
  });
});
