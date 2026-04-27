/**
 * WebSocket PTY terminal endpoint.
 *
 * `GET /ws/terminal?sessionId=<id>` — attach to an existing PTY session.
 * `GET /ws/terminal?workspaceId=<id>` — get-or-create the workspace's PTY
 *   session, then attach to it.
 *
 * Frame format (JSON):
 *   Server → client:  `{ kind: 'data', data: string }` | `{ kind: 'exit', exitCode: number }`
 *   Client → server:  `{ kind: 'data', data: string }` | `{ kind: 'resize', cols: number, rows: number }`
 */

import { Hono } from 'hono';
import { upgradeWebSocket } from '../index';
import { getPtySession, getPtySessionByWorkspace, getOrCreatePtySession } from '../lib/pty-manager';
import { TerminalFrameSchema } from '@crucible/types';
import { prisma } from '../lib/prisma';
import { auth } from '../lib/auth';

export const terminalApi = new Hono().get(
  '/ws/terminal',
  upgradeWebSocket(async (c) => {
    const sessionId = c.req.query('sessionId');
    const workspaceId = c.req.query('workspaceId');

    // Resolve session — prefer sessionId, fall back to workspaceId.
    let session = sessionId
      ? getPtySession(sessionId)
      : workspaceId
        ? getPtySessionByWorkspace(workspaceId)
        : undefined;

    // If no session exists yet and we have a workspaceId, create one.
    if (!session && workspaceId) {
      // Ownership check before spawning.
      const authSession = await auth.api.getSession({ headers: c.req.raw.headers });
      const userId = authSession?.user.id ?? null;
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true, userId: true },
      });
      if (!workspace || (workspace.userId !== null && workspace.userId !== userId)) {
        // Can't send a 404 over the WebSocket upgrade path cleanly — just
        // close immediately after the handshake.
        return {
          onOpen(_event, ws) {
            ws.close(4004, 'Workspace not found');
          },
        };
      }
      session = await getOrCreatePtySession(workspaceId).catch(() => undefined);
    }

    if (!session) {
      return {
        onOpen(_event, ws) {
          ws.close(4004, 'Session not found');
        },
      };
    }

    const resolvedSession = session;

    return {
      onOpen(_event, ws) {
        // Forward PTY output to the client.
        const removeData = resolvedSession.onData((data) => {
          ws.send(JSON.stringify({ kind: 'data', data }));
        });

        const removeExit = resolvedSession.onExit((exitCode) => {
          ws.send(JSON.stringify({ kind: 'exit', exitCode }));
          removeData();
          removeExit();
          ws.close(1000, 'PTY exited');
        });

        // Store cleanup refs on the ws context object (Bun allows attaching props).
        (ws as unknown as Record<string, unknown>)['_removeData'] = removeData;
        (ws as unknown as Record<string, unknown>)['_removeExit'] = removeExit;
      },

      onMessage(event) {
        const raw = typeof event.data === 'string' ? event.data : null;
        if (!raw) return;

        const parsed = TerminalFrameSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) return;

        const frame = parsed.data;
        if (frame.kind === 'data') {
          resolvedSession.write(frame.data);
        } else if (frame.kind === 'resize') {
          resolvedSession.resize(frame.cols, frame.rows);
        }
      },

      onClose(_event, ws) {
        const ctx = ws as unknown as Record<string, unknown>;
        (ctx['_removeData'] as (() => void) | undefined)?.();
        (ctx['_removeExit'] as (() => void) | undefined)?.();
      },
    };
  }),
);
