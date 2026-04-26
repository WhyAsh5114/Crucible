/**
 * Server-Sent Events endpoint for the agent event stream.
 *
 * `GET /api/agent/stream?workspaceId=<id>` — emits a `text/event-stream`
 * carrying real `AgentEvent`s for the given workspace. Authentication is
 * enforced by the upstream `requireSession` middleware in `src/index.ts`.
 *
 * The connection stays open as long as the client holds it. Events arrive
 * via the in-process `agent-bus`; if no producers publish, the stream is
 * silent (real, not faked). A keepalive comment is sent every 25s so
 * intermediaries don't drop idle connections.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { WorkspaceIdSchema } from '@crucible/types';
import { prisma } from '../lib/prisma';
import { subscribeAgentEvents } from '../lib/agent-bus';
import { createApiErrorBody } from '../lib/api-error';

const QuerySchema = z.object({
  workspaceId: WorkspaceIdSchema,
});

const KEEPALIVE_INTERVAL_MS = 25_000;

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
    select: { id: true },
  });
  if (!workspace) {
    return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
  }

  return streamSSE(c, async (stream) => {
    const subscription = subscribeAgentEvents(workspaceId);

    const keepalive = setInterval(() => {
      // SSE comment frames keep idle connections alive without affecting
      // the consumer's event log.
      void stream.writeSSE({ data: '', event: 'keepalive' });
    }, KEEPALIVE_INTERVAL_MS);

    stream.onAbort(() => {
      clearInterval(keepalive);
      subscription.unsubscribe();
    });

    try {
      for await (const event of subscription.events) {
        await stream.writeSSE({ data: JSON.stringify(event) });
      }
    } finally {
      clearInterval(keepalive);
      subscription.unsubscribe();
    }
  });
});
