/**
 * Per-workspace PTY session manager.
 *
 * Spawns a `node-pty` pseudoterminal for each workspace, persists the session
 * ID to `workspaceRuntime.terminalSessionId`, and provides attach/detach/resize
 * helpers consumed by the WebSocket terminal endpoint.
 *
 * At most one PTY session exists per workspace at a time.
 */

import pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import { prisma } from './prisma';
import { workspaceHostPath } from './workspace-fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PtyDataListener = (data: string) => void;
export type PtyExitListener = (exitCode: number) => void;

export type PtySession = {
  sessionId: string;
  workspaceId: string;
  cols: number;
  rows: number;
  cwd: string;
  startedAt: number;
  /** Write input to the PTY. */
  write: (data: string) => void;
  /** Resize the PTY. */
  resize: (cols: number, rows: number) => void;
  /** Subscribe to data output from the PTY. */
  onData: (listener: PtyDataListener) => () => void;
  /** Subscribe to PTY exit. */
  onExit: (listener: PtyExitListener) => () => void;
  /** Kill the PTY and clean up. */
  kill: () => void;
};

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** One session per workspace. */
const sessions = new Map<string, PtySession>();
/** workspaceId → sessionId reverse index. */
const workspaceIndex = new Map<string, string>();

const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;

const SHELL = process.env['SHELL'] ?? '/bin/bash';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create (or return existing) PTY session for a workspace. Persists the
 * session ID to the database.
 */
export async function getOrCreatePtySession(
  workspaceId: string,
  opts?: { cols?: number; rows?: number },
): Promise<PtySession> {
  const existingId = workspaceIndex.get(workspaceId);
  if (existingId) {
    const existing = sessions.get(existingId);
    if (existing) return existing;
  }

  const sessionId = `pty-${randomUUID()}`;
  const cwd = workspaceHostPath(workspaceId);
  const cols = opts?.cols ?? DEFAULT_COLS;
  const rows = opts?.rows ?? DEFAULT_ROWS;

  const proc = pty.spawn(SHELL, [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      WORKSPACE_ID: workspaceId,
    },
  });

  const dataListeners = new Set<PtyDataListener>();
  const exitListeners = new Set<PtyExitListener>();

  proc.onData((data) => {
    for (const listener of dataListeners) {
      try {
        listener(data);
      } catch {
        // Misbehaving listener must not crash the PTY.
      }
    }
  });

  proc.onExit(({ exitCode }) => {
    sessions.delete(sessionId);
    workspaceIndex.delete(workspaceId);
    for (const listener of exitListeners) {
      try {
        listener(exitCode ?? 0);
      } catch {
        // Ignore.
      }
    }
  });

  const session: PtySession = {
    sessionId,
    workspaceId,
    cols,
    rows,
    cwd,
    startedAt: Date.now(),
    write: (data) => proc.write(data),
    resize: (c, r) => {
      session.cols = c;
      session.rows = r;
      proc.resize(c, r);
    },
    onData: (listener) => {
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    },
    onExit: (listener) => {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
    kill: () => {
      proc.kill();
      sessions.delete(sessionId);
      workspaceIndex.delete(workspaceId);
    },
  };

  sessions.set(sessionId, session);
  workspaceIndex.set(workspaceId, sessionId);

  // Persist the session ID to the runtime row so the frontend can discover it.
  await prisma.workspaceRuntime
    .updateMany({
      where: { workspaceId },
      data: { terminalSessionId: sessionId },
    })
    .catch((err) => {
      console.warn(`[pty ${sessionId}] failed to persist sessionId to DB:`, err);
    });

  return session;
}

export function getPtySession(sessionId: string): PtySession | undefined {
  return sessions.get(sessionId);
}

export function getPtySessionByWorkspace(workspaceId: string): PtySession | undefined {
  const id = workspaceIndex.get(workspaceId);
  return id ? sessions.get(id) : undefined;
}

export function cleanupWorkspacePty(workspaceId: string): void {
  const id = workspaceIndex.get(workspaceId);
  if (id) {
    sessions.get(id)?.kill();
  }
}
