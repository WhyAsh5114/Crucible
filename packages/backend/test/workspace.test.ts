/**
 * HTTP integration tests for POST /workspace and GET /workspace/:id.
 *
 * Runs against the real Postgres DB (devcontainer). Each test creates its own
 * workspace and cleans up after itself so tests are fully isolated.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { workspaceApi } from '../src/api/workspace';
import { withAuth } from './with-auth';

// ── Helpers ──────────────────────────────────────────────────────────────────

const api = withAuth(workspaceApi);
const createdIds: string[] = [];

async function post(path: string, body: unknown) {
  return api.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function get(path: string) {
  return api.request(path, { method: 'GET' });
}

afterEach(async () => {
  // Best-effort cleanup: delete any workspaces created during the test.
  const { prisma } = await import('../src/lib/prisma');
  for (const id of createdIds.splice(0)) {
    await prisma.workspace.delete({ where: { id } }).catch(() => undefined);
  }
});

// ── POST /workspace ──────────────────────────────────────────────────────────

describe('POST /workspace', () => {
  it('returns 201 and a workspace id for a valid name', async () => {
    const res = await post('/workspace', { name: 'test-workspace' });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { id: string };
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);

    createdIds.push(body.id);
  });

  it('returns 400 for an empty name', async () => {
    const res = await post('/workspace', { name: '' });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('bad_request');
  });

  it('returns 400 for a name exceeding 100 characters', async () => {
    const res = await post('/workspace', { name: 'a'.repeat(101) });
    expect(res.status).toBe(400);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('bad_request');
  });

  it('returns 400 when name is missing', async () => {
    const res = await post('/workspace', {});
    expect(res.status).toBe(400);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('bad_request');
  });

  it('returns 400 for a non-JSON body', async () => {
    const res = await workspaceApi.request('/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('provisions a workspace directory on disk', async () => {
    const res = await post('/workspace', { name: 'dir-test' });
    expect(res.status).toBe(201);

    const { id } = (await res.json()) as { id: string };
    createdIds.push(id);

    const { existsSync } = await import('node:fs');
    const workspacesRoot = process.env['CRUCIBLE_WORKSPACES_ROOT']!;
    expect(existsSync(`${workspacesRoot}/${id}/contracts`)).toBe(true);
    expect(existsSync(`${workspacesRoot}/${id}/frontend`)).toBe(true);
  });
});

// ── GET /workspace/:id ───────────────────────────────────────────────────────

describe('GET /workspace/:id', () => {
  it('returns 200 with the workspace state for an existing workspace', async () => {
    // Create first.
    const createRes = await post('/workspace', { name: 'get-test' });
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };
    createdIds.push(id);

    const res = await get(`/workspace/${id}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      id: string;
      name: string;
      files: unknown[];
      chainState: unknown;
      deployments: unknown[];
    };
    expect(body.id).toBe(id);
    expect(body.name).toBe('get-test');
    expect(Array.isArray(body.files)).toBe(true);
    expect(Array.isArray(body.deployments)).toBe(true);
    expect(body.chainState).toBeNull();
  });

  it('returns 404 for an unknown but validly-formatted id', async () => {
    const res = await get('/workspace/non-existent-workspace-id');
    expect(res.status).toBe(404);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_found');
  });

  it('returns 400 for an id that fails the slug format', async () => {
    const res = await get('/workspace/INVALID_ID!!');
    expect(res.status).toBe(400);

    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('bad_request');
  });

  it('returns workspace files after creation', async () => {
    const createRes = await post('/workspace', { name: 'files-test' });
    expect(createRes.status).toBe(201);
    const { id } = (await createRes.json()) as { id: string };
    createdIds.push(id);

    const res = await get(`/workspace/${id}`);
    expect(res.status).toBe(200);

    // Freshly created workspace may have zero files (empty directories),
    // but the shape must be an array.
    const { files } = (await res.json()) as { files: unknown[] };
    expect(Array.isArray(files)).toBe(true);
  });
});
