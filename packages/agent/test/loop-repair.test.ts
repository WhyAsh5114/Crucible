/**
 * Unit tests for the self-healing repair loop helpers exported from loop.ts.
 *
 * Full integration tests (revert triggers loop, 3-failure cap, etc.) require
 * mocking `streamText` from the `ai` package, which is outside the scope of
 * these unit tests. The helpers are the testable core of the repair logic —
 * the prepareStep / onStepFinish callbacks in runAgentTurn delegate to them.
 */
import { describe, expect, test } from 'bun:test';
import {
  extractDeployRevert,
  extractSnapshotId,
  extractDeployMeta,
  extractSendTxRevert,
} from '../src/loop.ts';

// ── extractDeployRevert ──────────────────────────────────────────────────────

describe('extractDeployRevert', () => {
  test('returns reverted:false for non-deploy_local tool names', () => {
    const result = extractDeployRevert('compile', { isError: true, content: [] });
    expect(result.reverted).toBe(false);
  });

  test('returns reverted:false when isError is absent/false', () => {
    const result = extractDeployRevert('deploy_local', {
      isError: false,
      content: [{ type: 'text', text: '{"address":"0xabc"}' }],
    });
    expect(result.reverted).toBe(false);
  });

  test('returns reverted:false when result has no isError field', () => {
    const result = extractDeployRevert('deploy_local', {
      content: [{ type: 'text', text: '{"address":"0xabc"}' }],
    });
    expect(result.reverted).toBe(false);
  });

  test('extracts revert with decoded reason string', () => {
    const txHash = '0x' + 'a'.repeat(64);
    const result = extractDeployRevert('deploy_local', {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Transaction reverted: ${txHash} reverted with reason: "Ownable: caller is not the owner"`,
        },
      ],
    });
    if (!result.reverted) throw new Error('Expected reverted:true');
    expect(result.txHash).toBe(txHash);
    expect(result.revertSignature).toBe('Ownable: caller is not the owner');
  });

  test('returns reverted:false for infrastructure errors without revert language', () => {
    // "contract not found" is an MCP/tooling error, not an EVM revert
    const result = extractDeployRevert('deploy_local', {
      isError: true,
      content: [{ type: 'text', text: 'Error: Contract "DemoVault" not found in artifact store' }],
    });
    expect(result.reverted).toBe(false);
  });

  test('returns reverted:false for other infrastructure errors', () => {
    const result = extractDeployRevert('deploy_local', {
      isError: true,
      content: [{ type: 'text', text: 'node not running' }],
    });
    expect(result.reverted).toBe(false);
  });

  test('falls back to raw message when no txHash in error text but has revert keyword', () => {
    const result = extractDeployRevert('deploy_local', {
      isError: true,
      content: [{ type: 'text', text: 'Transaction reverted without a reason string' }],
    });
    if (!result.reverted) throw new Error('Expected reverted:true');
    expect(result.txHash).toBe('0x' + '0'.repeat(64));
    expect(result.revertSignature).toBe('Transaction reverted without a reason string');
  });

  test('returns reverted:false when content is missing (no revert signal)', () => {
    const result = extractDeployRevert('deploy_local', { isError: true });
    expect(result.reverted).toBe(false);
  });

  test('concatenates multiple text content blocks', () => {
    const txHash = '0x' + 'b'.repeat(64);
    const result = extractDeployRevert('deploy_local', {
      isError: true,
      content: [
        { type: 'text', text: `Transaction ${txHash} ` },
        { type: 'text', text: 'reverted' },
      ],
    });
    if (!result.reverted) throw new Error('Expected reverted:true');
    expect(result.txHash).toBe(txHash);
  });
});

// ── extractSnapshotId ────────────────────────────────────────────────────────

describe('extractSnapshotId', () => {
  test('extracts snapshotId from valid MCP text content', () => {
    const result = extractSnapshotId({
      isError: false,
      content: [{ type: 'text', text: '{"snapshotId":"snap_42"}' }],
    });
    expect(result).toBe('snap_42');
  });

  test('returns null when isError is true', () => {
    const result = extractSnapshotId({
      isError: true,
      content: [{ type: 'text', text: '{"snapshotId":"snap_1"}' }],
    });
    expect(result).toBeNull();
  });

  test('returns null when snapshotId field is missing', () => {
    const result = extractSnapshotId({
      isError: false,
      content: [{ type: 'text', text: '{"blockNumber":42}' }],
    });
    expect(result).toBeNull();
  });

  test('returns null when content is not valid JSON', () => {
    const result = extractSnapshotId({
      isError: false,
      content: [{ type: 'text', text: 'not-json' }],
    });
    expect(result).toBeNull();
  });

  test('returns null when result is null/undefined', () => {
    expect(extractSnapshotId(null)).toBeNull();
    expect(extractSnapshotId(undefined)).toBeNull();
  });

  test('returns null when content array is empty', () => {
    const result = extractSnapshotId({ isError: false, content: [] });
    expect(result).toBeNull();
  });
});

// ── extractDeployMeta ────────────────────────────────────────────────────────

describe('extractDeployMeta', () => {
  test('returns null for non-deploy_local tool names', () => {
    expect(extractDeployMeta('compile', { contractName: 'Counter' })).toBeNull();
  });

  test('returns null when contractName is missing', () => {
    expect(extractDeployMeta('deploy_local', {})).toBeNull();
    expect(extractDeployMeta('deploy_local', { sourcePath: 'contracts/Counter.sol' })).toBeNull();
  });

  test('extracts contractName and sourcePath when both present', () => {
    const result = extractDeployMeta('deploy_local', {
      contractName: 'Counter',
      sourcePath: 'contracts/Counter.sol',
    });
    expect(result).toEqual({ contractName: 'Counter', sourcePath: 'contracts/Counter.sol' });
  });

  test('derives sourcePath from contractName when not provided', () => {
    const result = extractDeployMeta('deploy_local', { contractName: 'Vault' });
    expect(result).toEqual({ contractName: 'Vault', sourcePath: 'contracts/Vault.sol' });
  });

  test('uses provided sourcePath even if it differs from contractName', () => {
    const result = extractDeployMeta('deploy_local', {
      contractName: 'Lock',
      sourcePath: 'contracts/v2/Lock.sol',
    });
    expect(result?.sourcePath).toBe('contracts/v2/Lock.sol');
  });
});

// ── extractSendTxRevert ──────────────────────────────────────────────────────

describe('extractSendTxRevert', () => {
  test('returns reverted:false for non-send_tx_local tool names', () => {
    expect(extractSendTxRevert('deploy_local', { isError: false })).toEqual({ reverted: false });
    expect(extractSendTxRevert('simulate_local', {})).toEqual({ reverted: false });
  });

  test('returns reverted:false when status is success', () => {
    const result = extractSendTxRevert('send_tx_local', {
      isError: false,
      content: [{ type: 'text', text: '{"txHash":"0xabc","gasUsed":"21000","status":"success"}' }],
    });
    expect(result.reverted).toBe(false);
  });

  test('returns reverted:true when status is reverted', () => {
    const txHash = '0x' + 'a'.repeat(64);
    const result = extractSendTxRevert('send_tx_local', {
      isError: false,
      content: [
        {
          type: 'text',
          text: JSON.stringify({ txHash, gasUsed: '50000', status: 'reverted' }),
        },
      ],
    });
    if (!result.reverted) throw new Error('Expected reverted:true');
    expect(result.txHash).toBe(txHash);
    expect(result.revertSignature).toContain('transaction reverted');
  });

  test('returns reverted:false when isError is true', () => {
    const result = extractSendTxRevert('send_tx_local', {
      isError: true,
      content: [{ type: 'text', text: '{"status":"reverted","txHash":"0xabc"}' }],
    });
    expect(result.reverted).toBe(false);
  });

  test('returns reverted:false for null/undefined result', () => {
    expect(extractSendTxRevert('send_tx_local', null)).toEqual({ reverted: false });
    expect(extractSendTxRevert('send_tx_local', undefined)).toEqual({ reverted: false });
  });

  test('returns reverted:false when content is not valid JSON', () => {
    const result = extractSendTxRevert('send_tx_local', {
      isError: false,
      content: [{ type: 'text', text: 'not-json' }],
    });
    expect(result.reverted).toBe(false);
  });

  test('falls back to zero txHash when txHash is absent in body', () => {
    const result = extractSendTxRevert('send_tx_local', {
      isError: false,
      content: [{ type: 'text', text: '{"status":"reverted"}' }],
    });
    if (!result.reverted) throw new Error('Expected reverted:true');
    expect(result.txHash).toBe('0x' + '0'.repeat(64));
  });
});
