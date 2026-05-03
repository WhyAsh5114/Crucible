/**
 * Unit tests for AXLNodeManager.
 *
 * These tests exercise the synchronous/in-process logic that does NOT require
 * the AXL binary to be present:
 *   - verifyPeerPatch   — structural validation, no network call
 *   - collectResponses  — queue drain, no network call (waitMs=0 for speed)
 *   - getOwnPublicKey   — empty before start()
 */

import { describe, it, expect } from 'bun:test';
import { AXLNodeManager } from '../src/node-manager.ts';
import type { VerifyPeerPatchInput } from '@crucible/types/mcp/mesh';

// A valid 64-hex-char (32-byte) receipt value accepted by HashSchema.
const VALID_RECEIPT = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
const VALID_REQ_ID = 'test-req-id-0001';
const VALID_PEER_ID = 'peer-0001';

function makeResponse(
  overrides: Partial<{
    patch: string;
    verificationReceipt: string;
    reqId: string;
    peerId: string;
  }> = {},
) {
  return {
    reqId: (overrides.reqId ?? VALID_REQ_ID) as VerifyPeerPatchInput['response']['reqId'],
    peerId: (overrides.peerId ?? VALID_PEER_ID) as VerifyPeerPatchInput['response']['peerId'],
    patch:
      overrides.patch ??
      '--- a/contracts/Token.sol\n+++ b/contracts/Token.sol\n@@ -1 +1 @@\n-bad\n+good',
    verificationReceipt: (overrides.verificationReceipt ??
      VALID_RECEIPT) as VerifyPeerPatchInput['response']['verificationReceipt'],
    respondedAt: Date.now() as VerifyPeerPatchInput['response']['respondedAt'],
  };
}

describe('AXLNodeManager — verifyPeerPatch', () => {
  const manager = new AXLNodeManager('/tmp/crucible-test-node-manager');

  it('returns failed when patch is empty', () => {
    const result = manager.verifyPeerPatch({ response: makeResponse({ patch: '' }) });
    expect(result.result).toBe('failed');
    expect((result as { result: 'failed'; reason: string }).reason).toContain('empty');
  });

  it('returns failed when verificationReceipt is not 0x-prefixed', () => {
    const result = manager.verifyPeerPatch({
      response: makeResponse({ verificationReceipt: 'deadbeef' }),
    });
    expect(result.result).toBe('failed');
    expect((result as { result: 'failed'; reason: string }).reason).toContain(
      'verificationReceipt',
    );
  });

  it('returns failed when verificationReceipt is too short', () => {
    const result = manager.verifyPeerPatch({
      response: makeResponse({ verificationReceipt: '0x' }),
    });
    expect(result.result).toBe('failed');
  });

  it('returns verified with a localReceipt for a valid response', () => {
    const result = manager.verifyPeerPatch({ response: makeResponse() });
    expect(result.result).toBe('verified');
    const ok = result as { result: 'verified'; localReceipt: string };
    expect(ok.localReceipt.startsWith('0x')).toBe(true);
    expect(ok.localReceipt.length).toBeGreaterThan(10);
  });

  it('deterministically produces the same localReceipt for the same input', () => {
    const r1 = manager.verifyPeerPatch({ response: makeResponse() });
    const r2 = manager.verifyPeerPatch({ response: makeResponse() });
    expect(r1).toEqual(r2);
  });
});

describe('AXLNodeManager — collectResponses', () => {
  it('returns empty responses for an unknown reqId with waitMs=0', async () => {
    const manager = new AXLNodeManager('/tmp/crucible-test-collect');
    const result = await manager.collectResponses({
      reqId: 'unknown-req-xyz' as VerifyPeerPatchInput['response']['reqId'],
      waitMs: 0,
    });
    expect(result.responses).toEqual([]);
  });
});

describe('AXLNodeManager — getOwnPublicKey', () => {
  it('returns empty string before start()', () => {
    const manager = new AXLNodeManager('/tmp/crucible-test-pubkey');
    expect(manager.getOwnPublicKey()).toBe('');
  });
});
