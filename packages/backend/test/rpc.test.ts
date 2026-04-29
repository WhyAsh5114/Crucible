/**
 * HTTP integration tests for POST /workspace/:id/rpc.
 *
 * Runs against the real Postgres DB (devcontainer). Docker-dependent cases
 * (actual chain proxying) require a running workspace container; the suite
 * covers auth, ownership, and allowlist validation without Docker.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rpcApi } from '../src/api/rpc';
import { createTestSession, deleteTestUser, type TestSession } from './helpers';

// ── Helpers ───────────────────────────────────────────────────────────────────

let session: TestSession;
let otherSession: TestSession;

beforeEach(async () => {
  session = await createTestSession();
  otherSession = await createTestSession();
});

afterEach(async () => {
  await deleteTestUser(session.userId);
  await deleteTestUser(otherSession.userId);
});

async function createWorkspace(s: TestSession, name: string): Promise<string> {
  const { prisma } = await import('../src/lib/prisma');
  const { randomUUID } = await import('node:crypto');
  const workspace = await prisma.workspace.create({
    data: {
      name,
      directoryPath: `pending://${randomUUID()}`,
      deployments: [],
      userId: s.userId,
    },
    select: { id: true },
  });
  return workspace.id;
}

async function postRpc(
  workspaceId: string,
  body: unknown,
  cookie = session.cookie,
): Promise<Response> {
  return rpcApi.request(`/workspace/${workspaceId}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

// ── Auth guard ────────────────────────────────────────────────────────────────

describe('POST /workspace/:id/rpc — auth guard', () => {
  it('returns 401 when unauthenticated', async () => {
    const id = await createWorkspace(session, 'auth-test');
    const res = await rpcApi.request(`/workspace/${id}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'eth_chainId', params: [] }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('unauthorized');
  });
});

// ── Ownership guard ────────────────────────────────────────────────────────────

describe('POST /workspace/:id/rpc — ownership guard', () => {
  it('returns 404 when workspace belongs to another user', async () => {
    const id = await createWorkspace(otherSession, 'ownership-test');
    const res = await postRpc(id, { method: 'eth_chainId', params: [] });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_found');
  });

  it('returns 404 for a nonexistent workspace id', async () => {
    const res = await postRpc('nonexistent-id', { method: 'eth_chainId', params: [] });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_found');
  });
});

// ── Method allowlist ──────────────────────────────────────────────────────────

describe('POST /workspace/:id/rpc — method allowlist', () => {
  it('returns 400 for hardhat_impersonateAccount', async () => {
    const id = await createWorkspace(session, 'allowlist-test');
    const res = await postRpc(id, {
      method: 'hardhat_impersonateAccount',
      params: ['0x1234567890123456789012345678901234567890'],
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('bad_request');
  });

  it('returns 400 for debug_traceTransaction', async () => {
    const id = await createWorkspace(session, 'allowlist-test-debug');
    const res = await postRpc(id, { method: 'debug_traceTransaction', params: [] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('bad_request');
  });

  it('returns 400 for a missing method field', async () => {
    const id = await createWorkspace(session, 'allowlist-test-missing');
    const res = await postRpc(id, { params: [] });
    expect(res.status).toBe(400);
  });
});

// ── eth_chainId fast-path (DB — no Docker required) ──────────────────────────

describe('POST /workspace/:id/rpc — eth_chainId fast-path', () => {
  it('returns chainId from DB chainState when available', async () => {
    const { prisma } = await import('../src/lib/prisma');
    const { randomUUID } = await import('node:crypto');

    const workspace = await prisma.workspace.create({
      data: {
        name: 'chainid-test',
        directoryPath: `pending://${randomUUID()}`,
        deployments: [],
        userId: session.userId,
      },
      select: { id: true },
    });

    await prisma.workspaceRuntime.create({
      data: {
        workspaceId: workspace.id,
        status: 'ready',
        startedAt: new Date(),
        chainState: {
          chainId: 31337,
          blockNumber: 0,
          gasPrice: '1',
          accounts: [],
          isForked: false,
          activeSnapshotIds: [],
        },
      },
    });

    const res = await postRpc(workspace.id, { method: 'eth_chainId', params: [] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe('0x7a69'); // 31337 in hex
  });

  it('returns 0x7a69 as best-effort when chainState is null', async () => {
    const { prisma } = await import('../src/lib/prisma');
    const { randomUUID } = await import('node:crypto');

    const workspace = await prisma.workspace.create({
      data: {
        name: 'chainid-null-test',
        directoryPath: `pending://${randomUUID()}`,
        deployments: [],
        userId: session.userId,
      },
      select: { id: true },
    });
    // No runtime row — chainState will be null
    const res = await postRpc(workspace.id, { method: 'eth_chainId', params: [] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: string };
    expect(body.result).toBe('0x7a69');
  });
});

// ── 503 when chain container port is not set ─────────────────────────────────

describe('POST /workspace/:id/rpc — 503 when container port missing', () => {
  it('returns 503 for a non-chainId method when chainPort is null', async () => {
    const { prisma } = await import('../src/lib/prisma');
    const { randomUUID } = await import('node:crypto');

    const workspace = await prisma.workspace.create({
      data: {
        name: 'no-port-test',
        directoryPath: `pending://${randomUUID()}`,
        deployments: [],
        userId: session.userId,
      },
      select: { id: true },
    });
    // Runtime exists but chainPort is null
    await prisma.workspaceRuntime.create({
      data: {
        workspaceId: workspace.id,
        status: 'starting',
        startedAt: new Date(),
        // chainPort intentionally omitted (null)
      },
    });

    const res = await postRpc(workspace.id, { method: 'eth_blockNumber', params: [] });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('runtime_unavailable');
  });
});
