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
import { auth } from '../lib/auth';

const QuerySchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

const KEEPALIVE_INTERVAL_MS = 15_000;

export const agentApi = new OpenAPIHono().get('/agent/stream', async (c) => {
  const parsed = QuerySchema.safeParse({ workspaceId: c.req.query('workspaceId') });
  if (!parsed.success) {
    return c.json(
      createApiErrorBody('bad_request', parsed.error.issues[0]?.message ?? 'Invalid workspaceId'),
      400,
    );
  }

  const { workspaceId } = parsed.data;

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, userId: true },
  });
  if (!workspace) {
    return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const userId = session?.user.id ?? null;
  if (workspace.userId !== null && workspace.userId !== userId) {
    return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
  }

  const subscription = subscribeAgentEvents(workspaceId);
  const encoder = new TextEncoder();

  const body = new ReadableStream({
    start(controller) {
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
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
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
});
