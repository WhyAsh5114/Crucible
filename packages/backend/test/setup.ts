/**
 * Test environment bootstrap — runs before any test file via bunfig.toml preload.
 *
 * Sets required environment variables using `??=` so values already present in
 * the process environment (e.g. from the devcontainer) are never overridden.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll } from 'bun:test';

// ── Database ─────────────────────────────────────────────────────────────────
// Default to the devcontainer Postgres service. Override via DATABASE_URL.
process.env['DATABASE_URL'] ??= 'postgresql://postgres:postgres@localhost:5432/crucible';

// ── Auth stubs (not exercised by route tests, but lib/auth.ts is not imported
//    when testing sub-apps directly) ─────────────────────────────────────────
process.env['BETTER_AUTH_URL'] ??= 'http://localhost:5000';
process.env['GOOGLE_CLIENT_ID'] ??= 'test-client-id';
process.env['GOOGLE_CLIENT_SECRET'] ??= 'test-client-secret';

// ── Workspace filesystem ─────────────────────────────────────────────────────
// Use a per-run temp directory so tests never touch production workspace data.
const testWorkspacesRoot = await mkdtemp(join(tmpdir(), 'crucible-test-workspaces-'));
process.env['CRUCIBLE_WORKSPACES_ROOT'] = testWorkspacesRoot;

afterAll(async () => {
  await rm(testWorkspacesRoot, { recursive: true, force: true });
});

// ── Docker / runtime defaults ─────────────────────────────────────────────────
process.env['CRUCIBLE_RUNTIME_IMAGE'] ??= 'ubuntu:24.04';
process.env['CRUCIBLE_RUNTIME_MOUNT_MODE'] ??= 'bind';

// Tests use a generic base image (no MCP services), so the readiness probe
// will always time out. Keep that timeout short to avoid blocking the suite.
process.env['CRUCIBLE_RUNTIME_READY_TIMEOUT_MS'] ??= '500';
process.env['CRUCIBLE_RUNTIME_READY_INTERVAL_MS'] ??= '100';

// ── Test user for ownership-gated route tests ───────────────────────────────
// API handlers read `userId` from `c.get('userId')`, set by the requireSession
// middleware in production. Sub-app tests bypass that middleware, so we upsert
// a stable test user and inject its id via the `withAuth()` helper in
// test/with-auth.ts.
export const TEST_USER_ID = 'test-user-id';
{
  const { prisma } = await import('../src/lib/prisma');
  await prisma.user.upsert({
    where: { id: TEST_USER_ID },
    create: {
      id: TEST_USER_ID,
      name: 'Test User',
      email: 'test@crucible.local',
      emailVerified: false,
    },
    update: {},
  });
}
