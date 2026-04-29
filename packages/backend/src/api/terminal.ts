/**
 * WebSocket PTY terminal endpoint.
 *
 * `GET /ws/terminal?sessionId=<id>` — attach to an existing PTY session.
 * `GET /ws/terminal?workspaceId=<id>` — get-or-create the workspace's PTY
 *   session (an interactive bash inside the runner container), then attach.
 *
 * Frame format (JSON):
 *   Server → client:  `{ kind: 'data', data: string }` | `{ kind: 'exit', exitCode: number }`
 *   Client → server:  `{ kind: 'data', data: string }` | `{ kind: 'resize', cols: number, rows: number }`
 *
 * Close codes (4xxx are application-level, surfaced to the user):
 *   1000 — normal close (PTY exited or component unmounted).
 *   4400 — request missing both `workspaceId` and `sessionId`.
 *   4404 — workspace not found or not owned by the session user.
 *   4503 — runtime container not running; the user must wait for boot or retry.
 *   4500 — failed to spawn the PTY (Docker error, exec failure, etc.).
 *
 * IMPORTANT — two design rules baked into the layout below:
 *
 * 1. The `upgradeWebSocket` callback returns synchronously. Auth, DB lookup,
 *    and the docker-exec round-trip all happen inside `onOpen` so the `101`
 *    upgrade response goes out within microseconds — otherwise Vite's
 *    upstream proxy closes the connection before the backend replies and the
 *    browser sees "no status, 0 B".
 *
 * 2. Per-connection state lives in CLOSURE SCOPE, not on the `ws` object.
 *    Hono creates a fresh `WSContext` wrapper for each handler invocation,
 *    so a property set on `ws` inside `onOpen` is invisible to a subsequent
 *    `onMessage` — that's why earlier attempts at `(ws as any).session = …`
 *    silently dropped every keystroke from the user.
 */

import { Hono } from 'hono';
import { upgradeWebSocket } from '../index';
import {
  getPtySession,
  getPtySessionByWorkspace,
  getOrCreatePtySession,
  type PtySession,
} from '../lib/pty-manager';
import { TerminalFrameSchema } from '@crucible/types';
import { prisma } from '../lib/prisma';
import { auth } from '../lib/auth';

export const terminalApi = new Hono().get(
  '/ws/terminal',
  upgradeWebSocket((c) => {
    const sessionId = c.req.query('sessionId');
    const workspaceId = c.req.query('workspaceId');
    // Capture headers now — `c.req.raw` is no longer safe to read after the
    // upgrade response is sent.
    const headers = new Headers(c.req.raw.headers);

    // Closure-scoped per-connection state. Visible to all three handlers
    // returned below regardless of how Hono wraps the underlying ws.
    let session: PtySession | undefined;
    let removeData: (() => void) | undefined;
    let removeExit: (() => void) | undefined;

    return {
      async onOpen(_event, ws) {
        // ---- 1. Resolve / create the PTY session -----------------------
        if (sessionId) {
          session = getPtySession(sessionId);
          if (!session) {
            ws.close(4404, 'Session not found');
            return;
          }
        } else if (workspaceId) {
          // Ownership check first.
          const authSession = await auth.api.getSession({ headers });
          const userId = authSession?.user.id ?? null;
          const workspace = await prisma.workspace
            .findUnique({
              where: { id: workspaceId },
              select: { id: true, userId: true },
            })
            .catch(() => null);

          if (!workspace || (workspace.userId !== null && workspace.userId !== userId)) {
            ws.close(4404, 'Workspace not found');
            return;
          }

          session = getPtySessionByWorkspace(workspaceId);
          if (!session) {
            try {
              session = await getOrCreatePtySession(workspaceId);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              const notRunning = message.includes('not running');
              const code = notRunning ? 4503 : 4500;
              const reason = notRunning ? 'Runtime not ready' : 'PTY spawn failed';
              console.warn(`[terminal] ${reason} for workspace ${workspaceId}: ${message}`);
              ws.close(code, reason);
              return;
            }
          }
        } else {
          ws.close(4400, 'Missing workspaceId or sessionId');
          return;
        }

        console.debug(`[terminal] attached ws to session ${session.sessionId}`);

        // ---- 2. Wire PTY → WS streaming --------------------------------
        removeData = session.onData((data) => {
          ws.send(JSON.stringify({ kind: 'data', data }));
        });

        removeExit = session.onExit((exitCode) => {
          ws.send(JSON.stringify({ kind: 'exit', exitCode }));
          removeData?.();
          removeExit?.();
          removeData = undefined;
          removeExit = undefined;
          ws.close(1000, 'PTY exited');
        });
      },

      onMessage(event) {
        // Closure capture — `session` is set by `onOpen` after the docker
        // exec round-trip completes. Frames that arrive before that race
        // are dropped (the frontend doesn't actually wire `term.onData`
        // until the WS is open AND xterm has rendered, so this is rare).
        if (!session) return;

        const raw = typeof event.data === 'string' ? event.data : null;
        if (!raw) return;

        let parsedJson: unknown;
        try {
          parsedJson = JSON.parse(raw);
        } catch {
          return;
        }

        const parsed = TerminalFrameSchema.safeParse(parsedJson);
        if (!parsed.success) return;

        const frame = parsed.data;
        if (frame.kind === 'data') {
          // Pass bytes through unchanged. The container's pty line discipline
          // (ICRNL) handles CR→NL translation; rewriting it here would break
          // raw-mode TUIs (vim, less, htop).
          session.write(frame.data);
        } else if (frame.kind === 'resize') {
          session.resize(frame.cols, frame.rows);
        }
      },

      onClose() {
        removeData?.();
        removeExit?.();
        removeData = undefined;
        removeExit = undefined;
        // Note: we deliberately do NOT kill the PTY session here. The session
        // is per-workspace and persists across page reloads / pane remounts,
        // so the next WS connect re-attaches to the same bash with its
        // accumulated history (replayed via the pending-output buffer).
        session = undefined;
      },
    };
  }),
);
