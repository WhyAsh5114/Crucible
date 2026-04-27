/**
 * Per-workspace Vite preview supervisor.
 *
 * Starts a `vite dev` process for the workspace's `frontend/` directory,
 * assigns a host port, and persists `previewUrl` to the DB so the frontend
 * shell can iframe it.
 *
 * One Vite process per workspace. Subsequent calls to `startPreview` while
 * a process is already running return the existing URL.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { EventEmitter } from 'node:events';
import path from 'node:path';
import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PreviewEntry = {
  process: ChildProcess;
  port: number;
  previewUrl: string;
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const previews = new Map<string, PreviewEntry>();

// ---------------------------------------------------------------------------
// Port helpers
// ---------------------------------------------------------------------------

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    (server as unknown as EventEmitter).on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      server.close(() => resolve((addr as { port: number }).port));
    });
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the Vite dev server for the workspace's `frontend/` directory.
 * Returns the preview URL. No-ops if already running.
 */
export async function startPreview(workspaceId: string, workspaceDir: string): Promise<string> {
  const existing = previews.get(workspaceId);
  if (existing) return existing.previewUrl;

  const port = await getFreePort();
  const frontendDir = path.join(workspaceDir, 'frontend');
  const previewUrl = `http://localhost:${port}`;

  const vite = spawn(
    'bun',
    ['run', '--cwd', frontendDir, 'vite', '--port', String(port), '--host', '127.0.0.1'],
    {
      cwd: frontendDir,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: 'pipe',
    },
  );

  (vite as unknown as EventEmitter).on('exit', () => {
    previews.delete(workspaceId);
    prisma.workspaceRuntime
      .updateMany({ where: { workspaceId }, data: { previewUrl: null } })
      .catch(() => undefined);
  });

  previews.set(workspaceId, { process: vite, port, previewUrl });

  await prisma.workspaceRuntime
    .updateMany({ where: { workspaceId }, data: { previewUrl } })
    .catch((err) => {
      console.warn(`[preview ${workspaceId}] failed to persist previewUrl:`, err);
    });

  return previewUrl;
}

/**
 * Stop the preview server for a workspace. No-ops if not running.
 */
export function stopPreview(workspaceId: string): void {
  const entry = previews.get(workspaceId);
  if (!entry) return;
  previews.delete(workspaceId);
  entry.process.kill('SIGTERM');
}

export function getPreviewUrl(workspaceId: string): string | null {
  return previews.get(workspaceId)?.previewUrl ?? null;
}
