import {
  workspaceHostPath,
  collectWorkspaceFiles,
  provisionWorkspaceDirectory,
  writeWorkspaceFile,
} from '../lib/workspace-fs';
import {
  ChainStateSchema,
  WorkspaceIdSchema,
  DeploymentRecordSchema,
  WorkspaceGetResponseSchema,
  WorkspaceCreateRequestSchema,
  WorkspaceCreateResponseSchema,
  WorkspaceListResponseSchema,
  FileWriteRequestSchema,
  FileWriteResponseSchema,
  ApiErrorSchema,
  StreamIdSchema,
} from '@crucible/types';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { createApiErrorBody } from '../lib/api-error';
import { ensureWorkspaceContainer } from '../lib/runtime-docker';
import { startPreview } from '../lib/preview-manager';
import { publishAgentEvent, nextAgentSeq } from '../lib/agent-bus';
import { requireSession } from '../lib/auth';

type ApiVariables = { userId: string };

// ── OpenAPI route definitions ────────────────────────────────────────────────

const createWorkspaceRoute = createRoute({
  method: 'post',
  path: '/workspace',
  request: {
    body: {
      content: { 'application/json': { schema: WorkspaceCreateRequestSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: WorkspaceCreateResponseSchema } },
      description: 'Workspace created',
    },
    400: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Bad request',
    },
    409: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Conflict',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    500: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Internal error',
    },
  },
});

const getWorkspaceRoute = createRoute({
  method: 'get',
  path: '/workspace/{id}',
  request: {
    params: z.object({ id: WorkspaceIdSchema }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: WorkspaceGetResponseSchema } },
      description: 'Workspace state',
    },
    400: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Bad request',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    404: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Not found',
    },
  },
});

const listWorkspacesRoute = createRoute({
  method: 'get',
  path: '/workspaces',
  responses: {
    200: {
      content: { 'application/json': { schema: WorkspaceListResponseSchema } },
      description: 'Workspaces owned by the authenticated user',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
  },
});

const fileWriteRoute = createRoute({
  method: 'put',
  path: '/workspace/{id}/file',
  request: {
    params: z.object({ id: WorkspaceIdSchema }),
    body: {
      content: { 'application/json': { schema: FileWriteRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: FileWriteResponseSchema } },
      description: 'File written successfully',
    },
    400: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Bad request',
    },
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
    },
    404: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Workspace not found',
    },
    500: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Internal error',
    },
  },
});

// ── Background runtime bootstrap ─────────────────────────────────────────────

/**
 * Spawn the per-workspace Docker container and upsert the WorkspaceRuntime
 * row. Runs as a background task triggered by workspace creation so the HTTP
 * create response returns immediately and the UI can navigate to the
 * workspace URL while the container boots.
 *
 * Status transitions: starting → ready | degraded | crashed.
 */
async function spawnRuntimeForWorkspace(workspaceId: string, directoryPath: string): Promise<void> {
  try {
    await prisma.workspaceRuntime.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        status: 'starting',
        startedAt: new Date(),
        chainState: Prisma.JsonNull,
      },
      update: { status: 'starting' },
      select: { runtimeId: true },
    });

    const container = await ensureWorkspaceContainer(workspaceId, directoryPath);

    await prisma.workspaceRuntime.update({
      where: { workspaceId },
      data: {
        status: container.ready ? 'ready' : 'degraded',
        startedAt: new Date(container.startedAtMs),
        chainPort: container.ports.chain,
        compilerPort: container.ports.compiler,
        deployerPort: container.ports.deployer,
        walletPort: container.ports.wallet,
        terminalPort: container.ports.terminal,
      },
    });

    // Start the per-workspace preview server in the background so
    // GET /api/workspace/:id eventually returns a non-null previewUrl.
    void startPreview(workspaceId, directoryPath).catch((err) => {
      console.warn(`[workspace ${workspaceId}] preview start failed:`, err);
    });
  } catch (err) {
    // Mark the runtime crashed so the UI can show a degraded state instead
    // of looking idle forever. The error itself is intentionally swallowed:
    // the user can still browse the workspace and retry via runtime API.
    console.error(`[workspace ${workspaceId}] runtime spawn failed:`, err);
    await prisma.workspaceRuntime
      .updateMany({
        where: { workspaceId, status: 'starting' },
        data: { status: 'crashed' },
      })
      .catch(() => undefined);
  }
}

// ── Router ───────────────────────────────────────────────────────────────────

const workspaceApiBase = new OpenAPIHono<{ Variables: ApiVariables }>({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        createApiErrorBody('bad_request', result.error.issues[0]?.message ?? 'Validation failed'),
        400,
      );
    }
    return undefined;
  },
});

// Auth guard: every route in this sub-app requires a valid session.
// Fast-path skips DB round-trip when userId was already set by a parent
// middleware (e.g. when mounted via app.route() in index.ts).
workspaceApiBase.use('*', requireSession);

export const workspaceApi = workspaceApiBase
  .openapi(createWorkspaceRoute, async (c) => {
    const { name } = c.req.valid('json');
    const userId = c.get('userId');

    let createdId: string | null = null;

    try {
      const created = await prisma.workspace.create({
        data: {
          deployments: [],
          name,
          directoryPath: `pending://${randomUUID()}`,
          userId,
        },
        select: { id: true },
      });
      createdId = created.id;

      const directoryPath = await provisionWorkspaceDirectory(created.id);
      await prisma.workspace.update({
        where: { id: created.id },
        data: { directoryPath },
        select: { id: true },
      });

      // Kick off the Docker container spawn + runtime row upsert in the
      // background so the create response stays fast. Failures here are
      // surfaced via the runtime status (degraded/crashed) rather than
      // blocking the workspace from being created.
      void spawnRuntimeForWorkspace(created.id, directoryPath);

      const response = WorkspaceCreateResponseSchema.parse({ id: created.id });
      return c.json(response, 201);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return c.json(createApiErrorBody('conflict', 'Workspace metadata already exists'), 409);
      }

      if (createdId) {
        await prisma.workspace.delete({ where: { id: createdId } }).catch(() => undefined);
      }

      return c.json(createApiErrorBody('internal', 'Failed to create workspace metadata'), 500);
    }
  })
  .openapi(getWorkspaceRoute, async (c) => {
    const { id } = c.req.valid('param');
    const userId = c.get('userId');

    const row = await prisma.workspace.findUnique({
      where: { id },
      include: { runtime: true },
    });

    // Treat foreign workspaces as 404 to avoid leaking the existence of
    // someone else's workspace IDs to a probing client.
    if (!row || row.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    if (row.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    const chainState = ChainStateSchema.safeParse(row.runtime?.chainState);
    const deployments = DeploymentRecordSchema.array().safeParse(row.deployments);
    const files = await collectWorkspaceFiles(row.directoryPath || workspaceHostPath(row.id));

    const response = WorkspaceGetResponseSchema.parse({
      files,
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.getTime(),
      previewUrl: row.runtime?.previewUrl ?? null,
      chainState: chainState.success ? chainState.data : null,
      deployments: deployments.success ? deployments.data : [],
      terminalSessionId: row.runtime?.terminalSessionId ?? null,
    });

    return c.json(response, 200);
  })
  .openapi(listWorkspacesRoute, async (c) => {
    const userId = c.get('userId');

    const rows = await prisma.workspace.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { runtime: { select: { status: true } } },
    });

    const response = WorkspaceListResponseSchema.parse({
      workspaces: rows.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: row.createdAt.getTime(),
        runtimeStatus: row.runtime?.status ?? null,
      })),
    });

    return c.json(response, 200);
  })
  .openapi(fileWriteRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { path: filePath, content } = c.req.valid('json');
    const userId = c.get('userId');

    const row = await prisma.workspace.findUnique({
      where: { id },
      select: { id: true, userId: true, directoryPath: true },
    });

    if (!row) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    if (row.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    const workspaceDir = row.directoryPath?.startsWith('pending://')
      ? workspaceHostPath(row.id)
      : (row.directoryPath ?? workspaceHostPath(row.id));

    try {
      const wf = await writeWorkspaceFile(row.id, filePath, content, workspaceDir);

      // Publish a file_write event so SSE subscribers (e.g. the editor)
      // see the change without polling.
      const streamId = StreamIdSchema.parse(row.id);
      publishAgentEvent(row.id, {
        streamId,
        seq: nextAgentSeq(row.id),
        emittedAt: Date.now(),
        type: 'file_write',
        path: wf.path,
        lang: wf.lang,
        hash: wf.hash,
        content: wf.content,
      });

      return c.json(FileWriteResponseSchema.parse(wf), 200);
    } catch (error) {
      return c.json(
        createApiErrorBody('internal', error instanceof Error ? error.message : 'Write failed'),
        500,
      );
    }
  });
