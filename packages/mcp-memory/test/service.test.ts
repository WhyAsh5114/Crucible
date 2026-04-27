import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mcp } from '@crucible/types';
import { createMemoryService } from '../src/service.ts';

describe('mcp-memory service', () => {
  let workspaceRoot = '';

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'crucible-mcp-memory-test-'));
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  it('remember appends pattern and provenance returns the same provenance', async () => {
    const service = createMemoryService({ workspaceRoot });

    const remembered = await service.remember({
      revertSignature: 'ERC20: insufficient allowance',
      patch: 'diff --git a/contracts/Token.sol b/contracts/Token.sol',
      traceRef: 'trace://abc123',
      verificationReceipt: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      scope: 'local',
    });

    expect(remembered.id.startsWith('pattern-')).toBe(true);

    const provenanceInput = mcp.memory.ProvenanceInputSchema.parse({ id: remembered.id });
    const provenance = await service.provenance(provenanceInput);
    expect(provenance.authorNode).toBeTruthy();
    expect(provenance.originalSession).toBeTruthy();
  });

  it('recall returns ranked hits for matching queries', async () => {
    const service = createMemoryService({ workspaceRoot });

    await service.remember({
      revertSignature: 'Vault: cooldown active',
      patch: 'update withdraw guard',
      traceRef: 'trace://cooldown',
      verificationReceipt: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      scope: 'local',
    });

    await service.remember({
      revertSignature: 'AccessControl: missing role',
      patch: 'add admin role assignment',
      traceRef: 'trace://role',
      verificationReceipt: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      scope: 'mesh',
    });

    const out = await service.recall({
      revertSignature: 'cooldown',
      limit: 3,
    });

    expect(out.hits.length).toBeGreaterThan(0);
    expect(out.hits[0]?.pattern.revertSignature).toContain('cooldown');
    expect(out.hits[0]?.score).toBeGreaterThan(0);
  });

  it('listPatterns paginates with cursor as offset', async () => {
    const service = createMemoryService({ workspaceRoot });

    await service.remember({
      revertSignature: 'Error A',
      patch: 'patch A',
      traceRef: 'trace://a',
      verificationReceipt: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      scope: 'local',
    });
    await service.remember({
      revertSignature: 'Error B',
      patch: 'patch B',
      traceRef: 'trace://b',
      verificationReceipt: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      scope: 'local',
    });

    const first = await service.listPatterns({ limit: 1 });
    expect(first.patterns).toHaveLength(1);
    expect(first.nextCursor).toBe('1');

    const second = await service.listPatterns({ limit: 1, cursor: first.nextCursor ?? undefined });
    expect(second.patterns).toHaveLength(1);
  });
});
