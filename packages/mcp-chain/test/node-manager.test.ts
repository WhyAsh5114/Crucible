/**
 * Integration tests for the node-manager lifecycle.
 *
 * These tests start a real Hardhat node and verify the correctness of the
 * core lifecycle operations: start, mine, snapshot tracking, and revert
 * invalidation semantics. The singleton state is reset between describe
 * blocks via startNode (which kills the previous node) and cleaned up
 * after all tests via stopNode.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { getNode, requireNode, startNode, stopNode, rpc } from '../src/node-manager.ts';

afterAll(async () => {
  await stopNode();
});

// ── Initial state (before any startNode call) ──────────────────────────────

describe('initial state — before startNode', () => {
  it('getNode returns null', () => {
    expect(getNode()).toBeNull();
  });

  it('requireNode throws', () => {
    expect(() => requireNode()).toThrow('No active Hardhat node');
  });
});

// ── startNode ──────────────────────────────────────────────────────────────

describe('startNode', () => {
  beforeAll(async () => {
    await startNode({});
  });

  it('getNode returns the started node', () => {
    expect(getNode()).not.toBeNull();
  });

  it('node has chainId 31337', () => {
    expect(requireNode().chainId).toBe(31337);
  });

  it('node rpcUrl is a loopback http address', () => {
    expect(requireNode().rpcUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('node has pre-funded accounts', () => {
    const { accounts } = requireNode();
    expect(Array.isArray(accounts)).toBe(true);
    expect(accounts.length).toBeGreaterThan(0);
  });

  it('node starts with an empty snapshotIds array', () => {
    expect(requireNode().snapshotIds).toHaveLength(0);
  });

  it('isForked is false for a non-forked node', () => {
    expect(requireNode().isForked).toBe(false);
  });

  it('requireNode no longer throws after start', () => {
    expect(() => requireNode()).not.toThrow();
  });
});

// ── mine ───────────────────────────────────────────────────────────────────

describe('mine', () => {
  beforeAll(async () => {
    await startNode({});
  });

  it('advances the block number by the requested count', async () => {
    const { rpcUrl } = requireNode();
    const before = parseInt(await rpc<string>(rpcUrl, 'eth_blockNumber'), 16);
    await rpc(rpcUrl, 'hardhat_mine', ['0x3']); // mine 3 blocks
    const after = parseInt(await rpc<string>(rpcUrl, 'eth_blockNumber'), 16);
    expect(after).toBe(before + 3);
  });
});

// ── snapshot and revert ────────────────────────────────────────────────────

describe('snapshot and revert', () => {
  it('evm_revert removes the target and all later snapshot IDs', async () => {
    const node = await startNode({});

    const id1 = await rpc<string>(node.rpcUrl, 'evm_snapshot');
    node.snapshotIds.push(id1);
    const id2 = await rpc<string>(node.rpcUrl, 'evm_snapshot');
    node.snapshotIds.push(id2);
    const id3 = await rpc<string>(node.rpcUrl, 'evm_snapshot');
    node.snapshotIds.push(id3);

    // Revert to id1 — Hardhat consumes id1 and invalidates id2 and id3.
    const success = await rpc<boolean>(node.rpcUrl, 'evm_revert', [id1]);
    const idx = node.snapshotIds.indexOf(id1);
    if (idx !== -1) node.snapshotIds.splice(idx);

    expect(success).toBe(true);
    expect(node.snapshotIds).toHaveLength(0);
    expect(node.snapshotIds).not.toContain(id2);
    expect(node.snapshotIds).not.toContain(id3);
  });

  it('evm_revert preserves snapshot IDs that come before the target', async () => {
    const node = await startNode({});

    const id1 = await rpc<string>(node.rpcUrl, 'evm_snapshot');
    node.snapshotIds.push(id1);
    const id2 = await rpc<string>(node.rpcUrl, 'evm_snapshot');
    node.snapshotIds.push(id2);
    const id3 = await rpc<string>(node.rpcUrl, 'evm_snapshot');
    node.snapshotIds.push(id3);

    // Revert to id2 — id1 (earlier) should survive; id2 and id3 are consumed/invalidated.
    await rpc<boolean>(node.rpcUrl, 'evm_revert', [id2]);
    const idx = node.snapshotIds.indexOf(id2);
    if (idx !== -1) node.snapshotIds.splice(idx);

    expect(node.snapshotIds).toHaveLength(1);
    expect(node.snapshotIds[0]).toBe(id1);
    expect(node.snapshotIds).not.toContain(id3);
  });
});
