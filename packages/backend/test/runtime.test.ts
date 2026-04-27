/**
 * HTTP integration tests for POST /runtime.
 *
 * Runs against the real Postgres DB (devcontainer). Docker-dependent cases
 * (open_workspace, close_workspace, tool_exec) require a Docker daemon; they
 * will fail gracefully if Docker is unavailable rather than being skipped.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { runtimeApi } from '../src/api/runtime';
import { withAuth } from './with-auth';
import { TEST_USER_ID } from './setup';

// ── Helpers ──────────────────────────────────────────────────────────────────

const api = withAuth(runtimeApi);
const createdWorkspaceIds: string[] = [];

async function postRuntime(body: unknown) {
  return api.request('/runtime', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Create a workspace row directly via Prisma for runtime tests. */
async function createTestWorkspace(name: string): Promise<string> {
  const { prisma } = await import('../src/lib/prisma');
  const { randomUUID } = await import('node:crypto');
  const workspace = await prisma.workspace.create({
    data: {
      name,
      directoryPath: `pending://${randomUUID()}`,
      deployments: [],
      userId: TEST_USER_ID,
    },
    select: { id: true },
  });
  createdWorkspaceIds.push(workspace.id);
  return workspace.id;
}

afterEach(async () => {
  const { prisma } = await import('../src/lib/prisma');
  for (const id of createdWorkspaceIds.splice(0)) {
    await prisma.workspaceRuntime.deleteMany({ where: { workspaceId: id } }).catch(() => undefined);
    await prisma.workspace.delete({ where: { id } }).catch(() => undefined);
  }
});

// ── Validation (no DB/Docker required) ───────────────────────────────────────

describe('POST /runtime — request validation', () => {
  it('returns 400 for an empty body', async () => {
    const res = await runtimeApi.request('/runtime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('bad_request');
  });

  it('returns 400 for an unknown type', async () => {
    const res = await postRuntime({ type: 'unknown_type', correlationId: 'corr-1' });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('bad_request');
  });

  it('returns 400 for a non-JSON body', async () => {
    const res = await runtimeApi.request('/runtime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when correlationId is missing', async () => {
    const res = await postRuntime({ type: 'runtime_status' });
    expect(res.status).toBe(400);
  });
});

// ── runtime_status (DB only, no Docker) ──────────────────────────────────────

describe('POST /runtime — runtime_status', () => {
  it('returns 200 with an empty descriptors array when no runtimes exist', async () => {
    const res = await postRuntime({ type: 'runtime_status', correlationId: 'corr-status-1' });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      type: string;
      correlationId: string;
      descriptors: unknown[];
    };
    expect(body.type).toBe('runtime_status');
    expect(body.correlationId).toBe('corr-status-1');
    expect(Array.isArray(body.descriptors)).toBe(true);
  });
});

// ── open_workspace / close_workspace (requires Docker) ───────────────────────

describe('POST /runtime — open_workspace', () => {
  it('returns 404 for an unknown workspace id', async () => {
    const res = await postRuntime({
      type: 'open_workspace',
      correlationId: 'corr-open-404',
      workspaceId: 'no-such-workspace',
    });
    expect(res.status).toBe(404);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_found');
  });

  it('returns 200 with a runtime descriptor when Docker is available', async () => {
    const workspaceId = await createTestWorkspace('runtime-open-test');

    const res = await postRuntime({
      type: 'open_workspace',
      correlationId: 'corr-open-1',
      workspaceId,
    });

    // Docker may not be available in all environments — accept 200 or 503.
    expect([200, 503]).toContain(res.status);

    if (res.status === 200) {
      const body = (await res.json()) as {
        type: string;
        correlationId: string;
        descriptor: { workspaceId: string; status: string };
      };
      expect(body.type).toBe('open_workspace');
      expect(body.descriptor.workspaceId).toBe(workspaceId);
      // 'ready' when the runtime image actually serves the in-container MCP
      // services; 'degraded' when the test image (e.g. ubuntu:24.04) lacks
      // them. Both are valid for the integration boundary check.
      expect(['ready', 'degraded']).toContain(body.descriptor.status);
    }
  }, 30_000);
});

describe('POST /runtime — close_workspace', () => {
  it('returns 404 for an unknown workspace id', async () => {
    const res = await postRuntime({
      type: 'close_workspace',
      correlationId: 'corr-close-404',
      workspaceId: 'no-such-workspace',
    });
    expect(res.status).toBe(404);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_found');
  });

  it('returns 200 with ok:true or 503 when Docker is available', async () => {
    const workspaceId = await createTestWorkspace('runtime-close-test');

    const res = await postRuntime({
      type: 'close_workspace',
      correlationId: 'corr-close-1',
      workspaceId,
    });

    expect([200, 503]).toContain(res.status);

    if (res.status === 200) {
      const body = (await res.json()) as { type: string; ok: boolean };
      expect(body.type).toBe('close_workspace');
      expect(body.ok).toBe(true);
    }
  }, 30_000);
});

// ── tool_exec ─────────────────────────────────────────────────────────────────

describe('POST /runtime — tool_exec', () => {
  it('returns 404 for an unknown workspace id', async () => {
    const res = await postRuntime({
      type: 'tool_exec',
      correlationId: 'corr-tool-404',
      workspaceId: 'no-such-workspace',
      server: 'chain',
      tool: 'get_state',
      args: {},
    });
    expect(res.status).toBe(404);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_found');
  });
});
