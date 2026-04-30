/**
 * Shared in-process session state for mcp-terminal.
 *
 * Both the MCP tool path (server.ts) and the REST handler path (index.ts)
 * import from this module so they operate on the same session map regardless
 * of which entry point received the request.
 *
 * Session lifecycle:
 *   - One session per workspace (workspaceIndex enforces this).
 *   - Sessions are in-memory; they survive reconnects but not process restarts.
 *   - The interactive bash subprocess (for `write`) is lazily spawned on first write.
 *   - `exec` always spawns a fresh non-interactive subprocess.
 */

import { randomUUID } from 'node:crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

export type BashProcess = {
  /** Bun's piped stdin sink. */
  stdin: import('bun').FileSink;
  kill: () => void;
};

export type SessionRecord = {
  sessionId: string;
  workspaceId: string;
  cwd: string;
  cols: number;
  rows: number;
  startedAt: number;
  /** Lazily-spawned bash for `write` calls. Null until first write. */
  bash: BashProcess | null;
};

export type SessionView = {
  sessionId: string;
  workspaceId: string;
  cwd: string;
  cols: number;
  rows: number;
  startedAt: number;
};

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

// ── Shared state ──────────────────────────────────────────────────────────────

/** sessionId → session record */
export const sessions = new Map<string, SessionRecord>();
/** workspaceId → sessionId  (one active session per workspace) */
export const workspaceIndex = new Map<string, string>();

// ── Internal helpers ──────────────────────────────────────────────────────────

function toView(r: SessionRecord): SessionView {
  return {
    sessionId: r.sessionId,
    workspaceId: r.workspaceId,
    cwd: r.cwd,
    cols: r.cols,
    rows: r.rows,
    startedAt: r.startedAt,
  };
}

function spawnBash(session: SessionRecord, workspaceRoot: string): BashProcess {
  const proc = Bun.spawn(['bash', '-s'], {
    cwd: session.cwd || workspaceRoot,
    env: { ...process.env, WORKSPACE_ID: session.workspaceId } as Record<string, string>,
    // Inherit so bash's output appears in container logs without blocking.
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'pipe',
  });

  const bash: BashProcess = {
    stdin: proc.stdin,
    kill: () => {
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    },
  };

  void proc.exited.then(() => {
    if (session.bash === bash) {
      session.bash = null;
    }
  });

  return bash;
}

// ── Public operations ─────────────────────────────────────────────────────────

/**
 * Get-or-create the per-workspace bash session.
 * Idempotent: returns existing session for the workspace if one exists.
 */
export function createSession(
  workspaceId: string,
  cols: number | undefined,
  rows: number | undefined,
  workspaceRoot: string,
): SessionView {
  const existingId = workspaceIndex.get(workspaceId);
  if (existingId) {
    const existing = sessions.get(existingId);
    if (existing) return toView(existing);
  }

  const sessionId = `pty-${randomUUID()}`;
  const record: SessionRecord = {
    sessionId,
    workspaceId,
    cwd: workspaceRoot,
    cols: cols ?? 120,
    rows: rows ?? 32,
    startedAt: Date.now(),
    bash: null,
  };

  sessions.set(sessionId, record);
  workspaceIndex.set(workspaceId, sessionId);
  return toView(record);
}

/**
 * Write raw text to the session's interactive bash stdin.
 * Lazily spawns the bash process on first call.
 * Returns false if the session does not exist.
 */
export async function writeSession(
  sessionId: string,
  text: string,
  workspaceRoot: string,
): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session) return false;

  if (!session.bash) {
    session.bash = spawnBash(session, workspaceRoot);
  }

  session.bash.stdin.write(text);
  await session.bash.stdin.flush();
  return true;
}

/**
 * Execute a command NON-interactively in a fresh bash subprocess.
 * Captures stdout, stderr, and exit code.
 * Uses session cwd/env as context (session may be null for default context).
 */
export async function execCommand(
  sessionId: string,
  command: string,
  cwd: string | undefined,
  env: Record<string, string> | undefined,
  timeoutMs: number | undefined,
  workspaceRoot: string,
): Promise<ExecResult> {
  const session = sessions.get(sessionId);
  const resolvedCwd = cwd ?? session?.cwd ?? workspaceRoot;
  const resolvedTimeout = timeoutMs ?? 30_000;

  const mergedEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...(session ? { WORKSPACE_ID: session.workspaceId } : {}),
    ...(env ?? {}),
  };

  const proc = Bun.spawn(['bash', '-c', command], {
    cwd: resolvedCwd,
    env: mergedEnv,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  });

  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }, resolvedTimeout);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const timeoutNote = killed ? `\n[Process killed: timed out after ${resolvedTimeout}ms]` : '';
    return {
      stdout: stdout.trim(),
      stderr: (stderr + timeoutNote).trim(),
      exitCode: killed ? -1 : exitCode,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Update stored terminal dimensions for the session.
 * Returns false if the session does not exist.
 */
export function resizeSession(sessionId: string, cols: number, rows: number): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.cols = cols;
  session.rows = rows;
  return true;
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Kill all bash subprocesses and clear all sessions. Used in tests only. */
export function clearAllSessions(): void {
  for (const record of sessions.values()) {
    record.bash?.kill();
  }
  sessions.clear();
  workspaceIndex.clear();
}

/** Return the number of active sessions. */
export function sessionCount(): number {
  return sessions.size;
}
