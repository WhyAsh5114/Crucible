import {
  workspaceHostPath,
  collectWorkspaceFiles,
  provisionWorkspaceDirectory,
} from '../lib/workspace-fs';
import {
  ChainStateSchema,
  WorkspaceIdSchema,
  DeploymentRecordSchema,
  WorkspaceGetResponseSchema,
  WorkspaceCreateRequestSchema,
  WorkspaceCreateResponseSchema,
  ApiErrorSchema,
} from '@crucible/types';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client';
import { createApiErrorBody } from '../lib/api-error';
import { ensureWorkspaceContainer } from '../lib/runtime-docker';

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
    404: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Not found',
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
        terminalSessionId: `${workspaceId}-terminal`,
        chainPort: container.ports.chain,
        compilerPort: container.ports.compiler,
      },
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

export const workspaceApi = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        createApiErrorBody('bad_request', result.error.issues[0]?.message ?? 'Validation failed'),
        400,
      );
    }
    return undefined;
  },
})
  .openapi(createWorkspaceRoute, async (c) => {
    const { name } = c.req.valid('json');
    let createdId: string | null = null;

    try {
      const created = await prisma.workspace.create({
        data: {
          deployments: [],
          name,
          directoryPath: `pending://${randomUUID()}`,
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

    const row = await prisma.workspace.findUnique({
      where: { id },
      include: { runtime: true },
    });

    if (!row) {
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
  });
