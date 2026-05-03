/**
 * Per-workspace PTY session manager.
 *
 * Spawns an interactive bash inside the workspace runner container by talking
 * to the Docker engine API directly over its Unix socket. Each session opens
 * a raw connection, issues `POST /containers/{id}/exec` to create the exec,
 * then `POST /exec/{id}/start` with `Upgrade: tcp` to take over the
 * connection. After the `101 UPGRADED` response, the socket is a duplex
 * stream of TTY bytes.
 *
 * Why not dockerode? Bun's Node-compat HTTP layer doesn't implement the
 * hijack pattern dockerode relies on; `exec.start({hijack: true})` hangs
 * forever. Why not node-pty? Bun's process model can't sustain a controlling
 * terminal for an interactive child shell on Linux — bash gets SIGHUP within
 * microseconds of spawn. Talking to the Docker socket via `net.Socket`
 * sidesteps both bugs and is a few dozen lines of HTTP/1.1.
 *
 * One session per workspace; the session id is persisted to
 * `workspaceRuntime.terminalSessionId`.
 */

import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { prisma } from './prisma';
import { getRuntimeContainerName, getWorkspaceContainerState } from './runtime-docker';

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
// Config
// ---------------------------------------------------------------------------

const DOCKER_SOCKET = process.env['DOCKER_SOCKET_PATH'] ?? '/var/run/docker.sock';
const CONTAINER_WORKDIR = process.env['CRUCIBLE_RUNTIME_WORKDIR'] ?? '/workspace';
const CONTAINER_SHELL = process.env['CRUCIBLE_RUNTIME_SHELL'] ?? '/bin/bash';
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const MAX_PENDING_OUTPUT_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const sessions = new Map<string, PtySession>();
const workspaceIndex = new Map<string, string>();

export function appendPendingOutput(buffer: string, chunk: string): string {
  const combined = buffer + chunk;
  if (combined.length <= MAX_PENDING_OUTPUT_BYTES) return combined;
  return combined.slice(combined.length - MAX_PENDING_OUTPUT_BYTES);
}

// ---------------------------------------------------------------------------
// Minimal Docker engine HTTP client (Unix socket)
// ---------------------------------------------------------------------------

type SimpleResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

/**
 * One-shot HTTP/1.1 over the Docker Unix socket. Returns parsed status,
 * headers, and body (with chunked-transfer decoding for the simple case
 * Docker uses: a single chunk).
 */
function dockerHttp(method: string, path: string, body?: object): Promise<SimpleResponse> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(DOCKER_SOCKET);
    const bodyStr = body ? JSON.stringify(body) : '';
    const req =
      `${method} ${path} HTTP/1.1\r\n` +
      `Host: localhost\r\n` +
      `Content-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(bodyStr)}\r\n` +
      `Connection: close\r\n\r\n` +
      bodyStr;

    let buf = '';
    sock.on('data', (d) => {
      buf += d.toString('utf8');
    });
    sock.on('end', () => {
      const sep = buf.indexOf('\r\n\r\n');
      if (sep < 0) {
        reject(new Error('Docker HTTP: malformed response (no header terminator)'));
        return;
      }
      const head = buf.slice(0, sep);
      const lines = head.split('\r\n');
      const statusLine = lines.shift() ?? '';
      const status = parseInt(statusLine.split(' ')[1] ?? '0', 10);
      const headers: Record<string, string> = {};
      for (const l of lines) {
        const idx = l.indexOf(':');
        if (idx > 0) headers[l.slice(0, idx).toLowerCase()] = l.slice(idx + 1).trim();
      }
      let bodyOut = buf.slice(sep + 4);
      if (headers['transfer-encoding'] === 'chunked') {
        const m = bodyOut.match(/^([0-9a-fA-F]+)\r\n([\s\S]*?)\r\n0\r\n/);
        if (m) bodyOut = m[2] ?? '';
      }
      resolve({ status, headers, body: bodyOut });
    });
    sock.on('error', reject);
    sock.write(req);
  });
}

/**
 * Open an `exec.start` raw TCP-upgraded socket. Returns the upgraded socket
 * once the 101 response headers have been read; any leftover bytes are
 * pushed to `onData` immediately.
 */
function openExecHijack(execId: string, onData: (chunk: Buffer) => void): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(DOCKER_SOCKET);
    const startBody = JSON.stringify({ Detach: false, Tty: true });
    const req =
      `POST /exec/${execId}/start HTTP/1.1\r\n` +
      `Host: localhost\r\n` +
      `Content-Type: application/json\r\n` +
      `Upgrade: tcp\r\n` +
      `Connection: Upgrade\r\n` +
      `Content-Length: ${Buffer.byteLength(startBody)}\r\n\r\n` +
      startBody;

    let phase: 'header' | 'body' = 'header';
    let headerBuf = Buffer.alloc(0);

    const onChunk = (chunk: Buffer) => {
      if (phase === 'header') {
        headerBuf = Buffer.concat([headerBuf, chunk]);
        const sep = headerBuf.indexOf('\r\n\r\n');
        if (sep < 0) return;
        const head = headerBuf.slice(0, sep).toString('utf8');
        const statusLine = head.split('\r\n')[0] ?? '';
        const status = parseInt(statusLine.split(' ')[1] ?? '0', 10);
        if (status !== 101) {
          sock.removeListener('data', onChunk);
          reject(new Error(`Docker exec start failed: ${status} ${head}`));
          sock.destroy();
          return;
        }
        phase = 'body';
        sock.removeListener('data', onChunk);
        sock.on('data', onData);
        const leftover = headerBuf.slice(sep + 4);
        if (leftover.length > 0) onData(leftover);
        resolve(sock);
      }
    };
    sock.on('data', onChunk);
    sock.on('error', (err) => {
      if (phase === 'header') reject(err);
    });
    sock.write(req);
  });
}

type ExecInspect = { ExitCode: number | null; Running: boolean };

async function inspectExec(execId: string): Promise<ExecInspect | null> {
  try {
    const res = await dockerHttp('GET', `/exec/${execId}/json`);
    if (res.status !== 200) return null;
    return JSON.parse(res.body) as ExecInspect;
  } catch {
    return null;
  }
}

async function resizeExec(execId: string, cols: number, rows: number): Promise<void> {
  await dockerHttp('POST', `/exec/${execId}/resize?h=${rows}&w=${cols}`).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getOrCreatePtySession(
  workspaceId: string,
  opts?: { cols?: number; rows?: number },
): Promise<PtySession> {
  const existingId = workspaceIndex.get(workspaceId);
  if (existingId) {
    const existing = sessions.get(existingId);
    if (existing) return existing;
  }

  const state = await getWorkspaceContainerState(workspaceId);
  if (state !== 'running') {
    throw new Error(`Workspace runtime container is not running (state=${state})`);
  }

  const containerName = getRuntimeContainerName(workspaceId);
  const cols = opts?.cols ?? DEFAULT_COLS;
  const rows = opts?.rows ?? DEFAULT_ROWS;

  // Step 1: create exec.
  const createRes = await dockerHttp('POST', `/containers/${containerName}/exec`, {
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
    Cmd: [CONTAINER_SHELL, '-i'],
    WorkingDir: CONTAINER_WORKDIR,
    Env: ['TERM=xterm-256color', `WORKSPACE_ID=${workspaceId}`, `COLUMNS=${cols}`, `LINES=${rows}`],
  });
  if (createRes.status !== 201) {
    throw new Error(`Docker exec create failed: ${createRes.status} ${createRes.body}`);
  }
  const execId = (JSON.parse(createRes.body) as { Id: string }).Id;

  const sessionId = `pty-${randomUUID()}`;
  const dataListeners = new Set<PtyDataListener>();
  const exitListeners = new Set<PtyExitListener>();
  // Persistent scrollback: capped ring of the most recent PTY output. Appended
  // to on EVERY chunk regardless of how many listeners are attached, so a
  // freshly-mounted WebSocket (e.g. after a page reload) can replay the
  // recent terminal state — including the current shell prompt — without
  // having to wait for new output. Previously this only buffered while
  // detached, which meant a reload while the shell was idle showed an empty
  // pane until the user typed something.
  let scrollback = '';
  let disposed = false;

  const fanOut = (chunk: string) => {
    scrollback = appendPendingOutput(scrollback, chunk);
    for (const listener of dataListeners) {
      try {
        listener(chunk);
      } catch {
        // A misbehaving listener must not crash the PTY.
      }
    }
  };

  // Step 2: open the hijacked socket.
  const sock = await openExecHijack(execId, (chunk) => {
    fanOut(chunk.toString('utf8'));
  });

  // Apply initial size now that the PTY is alive.
  await resizeExec(execId, cols, rows);

  const finishExit = async () => {
    if (disposed) return;
    disposed = true;
    sessions.delete(sessionId);
    workspaceIndex.delete(workspaceId);
    const info = await inspectExec(execId);
    const exitCode = info?.ExitCode ?? 0;
    for (const listener of exitListeners) {
      try {
        listener(exitCode);
      } catch {
        // ignore
      }
    }
    await prisma.workspaceRuntime
      .updateMany({
        where: { workspaceId, terminalSessionId: sessionId },
        data: { terminalSessionId: null },
      })
      .catch(() => undefined);
  };

  sock.on('end', () => void finishExit());
  sock.on('close', () => void finishExit());
  sock.on('error', (err) => {
    console.warn(`[pty ${sessionId}] socket error:`, err);
  });

  const session: PtySession = {
    sessionId,
    workspaceId,
    cols,
    rows,
    cwd: CONTAINER_WORKDIR,
    startedAt: Date.now(),
    write: (data) => {
      if (disposed) return;
      try {
        sock.write(data);
      } catch (err) {
        console.warn(`[pty ${sessionId}] write failed:`, err);
      }
    },
    resize: (c, r) => {
      if (disposed) return;
      session.cols = c;
      session.rows = r;
      void resizeExec(execId, c, r);
    },
    onData: (listener) => {
      dataListeners.add(listener);
      // Replay the persistent scrollback so the new listener sees the
      // current terminal state immediately — shell prompt, recent output,
      // any in-flight input. Don't clear `scrollback` here; subsequent
      // attaches (e.g. another browser tab opening the same workspace)
      // need the same replay.
      if (scrollback.length > 0) {
        try {
          listener(scrollback);
        } catch {
          // ignore
        }
      }
      return () => {
        dataListeners.delete(listener);
      };
    },
    onExit: (listener) => {
      exitListeners.add(listener);
      return () => {
        exitListeners.delete(listener);
      };
    },
    kill: () => {
      if (disposed) return;
      disposed = true;
      try {
        sock.end();
      } catch {
        // ignore
      }
      try {
        sock.destroy();
      } catch {
        // ignore
      }
      sessions.delete(sessionId);
      workspaceIndex.delete(workspaceId);
    },
  };

  sessions.set(sessionId, session);
  workspaceIndex.set(workspaceId, sessionId);

  await prisma.workspaceRuntime
    .updateMany({
      where: { workspaceId },
      data: { terminalSessionId: sessionId },
    })
    .catch((err) => {
      console.warn(`[pty ${sessionId}] failed to persist sessionId to DB:`, err);
    });

  console.debug(
    `[pty ${sessionId}] hijacked docker exec on ${containerName} (exec=${execId.slice(0, 12)}, ${cols}x${rows})`,
  );

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
