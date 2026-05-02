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

  it('purge with scope deletes only matching scope patterns', async () => {
    const service = createMemoryService({ workspaceRoot });

    await service.remember({
      revertSignature: 'Local error',
      patch: 'local patch',
      traceRef: 'trace://local',
      verificationReceipt: `0x${'aa'.repeat(32)}` as `0x${string}`,
      scope: 'local',
    });
    await service.remember({
      revertSignature: 'Mesh error',
      patch: 'mesh patch',
      traceRef: 'trace://mesh',
      verificationReceipt: `0x${'bb'.repeat(32)}` as `0x${string}`,
      scope: 'mesh',
    });

    const result = await service.purge({ scope: 'local' });
    expect(result.deleted).toBe(1);

    // listPatterns defaults scope to 'local' — verify local is gone
    const localAfter = await service.listPatterns({ scope: 'local' });
    expect(localAfter.patterns).toHaveLength(0);

    // mesh pattern must survive
    const meshAfter = await service.listPatterns({ scope: 'mesh' });
    expect(meshAfter.patterns).toHaveLength(1);
    expect(meshAfter.patterns[0]?.scope).toBe('mesh');
  });

  it('purge without scope deletes all patterns', async () => {
    const service = createMemoryService({ workspaceRoot });

    for (const scope of ['local', 'mesh', 'local'] as const) {
      await service.remember({
        revertSignature: `Error ${scope}`,
        patch: `patch ${scope}`,
        traceRef: `trace://${scope}`,
        verificationReceipt: `0x${'cc'.repeat(32)}` as `0x${string}`,
        scope,
      });
    }

    const result = await service.purge({});
    expect(result.deleted).toBe(3);

    const remaining = await service.listPatterns({});
    expect(remaining.patterns).toHaveLength(0);
  });
});
