/**
 * Server-Sent Events endpoint for the agent event stream.
 *
 * `GET /api/agent/stream?workspaceId=<id>` — emits a `text/event-stream`
 * carrying real `AgentEvent`s for the given workspace. Authentication is
 * enforced by the upstream `requireSession` middleware in `src/index.ts`.
 *
 * Uses a raw ReadableStream Response (not Hono's streamSSE helper) because
 * Bun's HTTP server only reliably keeps long-lived connections open when the
 * response body is a native ReadableStream controller.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { WorkspaceIdSchema } from '@crucible/types';
import { prisma } from '../lib/prisma';
import { subscribeAgentEvents } from '../lib/agent-bus';
import { createApiErrorBody } from '../lib/api-error';

const QuerySchema = z.object({
  workspaceId: WorkspaceIdSchema,
  sessionId: z.string().optional(),
});

const KEEPALIVE_INTERVAL_MS = 15_000;

export const agentApi = new OpenAPIHono<{ Variables: { userId: string } }>().get(
  '/agent/stream',
  async (c) => {
    const parsed = QuerySchema.safeParse({
      workspaceId: c.req.query('workspaceId'),
      sessionId: c.req.query('sessionId'),
    });
    if (!parsed.success) {
      return c.json(
        createApiErrorBody('bad_request', parsed.error.issues[0]?.message ?? 'Invalid workspaceId'),
        400,
      );
    }

    const { workspaceId, sessionId: rawSessionId } = parsed.data;
    const userId = c.get('userId');

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, userId: true },
    });
    if (!workspace || workspace.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    // Resolve sessionId: use provided one (validate it), or fall back to the
    // most recent session for this workspace.
    let sessionId: string;
    if (rawSessionId) {
      const session = await prisma.chatSession.findUnique({
        where: { id: rawSessionId },
        select: { id: true, workspaceId: true },
      });
      if (!session || session.workspaceId !== workspaceId) {
        return c.json(createApiErrorBody('not_found', 'Chat session not found'), 404);
      }
      sessionId = session.id;
    } else {
      // Fall back to the most recent session.
      const latest = await prisma.chatSession.findFirst({
        where: { workspaceId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      if (!latest) {
        return c.json(createApiErrorBody('not_found', 'No chat sessions found for workspace'), 404);
      }
      sessionId = latest.id;
    }

    const subscription = subscribeAgentEvents(workspaceId, sessionId);
    const encoder = new TextEncoder();

    const body = new ReadableStream({
      start(controller) {
        // Push an immediate comment frame so proxies (Vite http-proxy, nginx)
        // flush the response straight away. Without a first body chunk some
        // proxies hold the response until 4 KiB accumulates, leaving the
        // EventSource stuck before `onopen` fires.
        controller.enqueue(encoder.encode(': connected\n\n'));

        // Keepalive: SSE comment frames every 15s so intermediaries don't close
        // idle connections.
        const keepalive = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(': keepalive\n\n'));
          } catch {
            clearInterval(keepalive);
          }
        }, KEEPALIVE_INTERVAL_MS);

        // Drain the async iterator in the background.
        void (async () => {
          try {
            for await (const event of subscription.events) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify(event, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}\n\n`,
                ),
              );
            }
          } catch {
            // Subscription closed or stream cancelled.
          } finally {
            clearInterval(keepalive);
            subscription.unsubscribe();
            try {
              controller.close();
            } catch {
              // Already closed.
            }
          }
        })();

        // Clean up when the client disconnects.
        c.req.raw.signal.addEventListener('abort', () => {
          clearInterval(keepalive);
          subscription.unsubscribe();
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        });
      },
      cancel() {
        subscription.unsubscribe();
      },
    });

    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  },
);
