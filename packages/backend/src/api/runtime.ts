import {
  ChainStateSchema,
  WorkspaceIdSchema,
  RuntimeStatusSchema,
  RuntimeRequestSchema,
  RuntimeResponseSchema,
  ApiErrorSchema,
} from '@crucible/types';
import {
  stopWorkspaceContainer,
  ensureWorkspaceContainer,
  getWorkspaceContainerState,
} from '../lib/runtime-docker';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { prisma } from '../lib/prisma';
import { Prisma } from '../generated/prisma/client';
import { executeRuntimeTool } from '../lib/tool-exec';
import { createApiErrorBody } from '../lib/api-error';
import { provisionWorkspaceDirectory, workspaceHostPath } from '../lib/workspace-fs';

// ── OpenAPI route definition ─────────────────────────────────────────────────

const runtimeRoute = createRoute({
  method: 'post',
  path: '/runtime',
  request: {
    body: {
      content: { 'application/json': { schema: RuntimeRequestSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: RuntimeResponseSchema } },
      description: 'Runtime operation result',
    },
    400: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Bad request',
    },
    404: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Not found',
    },
    501: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Not implemented',
    },
    503: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Runtime unavailable',
    },
  },
});

// ── Router ───────────────────────────────────────────────────────────────────

export const runtimeApi = new OpenAPIHono();

function toDescriptor(runtime: {
  runtimeId: string;
  workspaceId: string;
  status: string;
  startedAt: Date;
  previewUrl: string | null;
  terminalSessionId: string | null;
  chainPort: number | null;
  compilerPort: number | null;
  deployerPort: number | null;
  walletPort: number | null;
  terminalPort: number | null;
  chainState: unknown;
}) {
  const status = RuntimeStatusSchema.parse(runtime.status);
  const chainState = ChainStateSchema.safeParse(runtime.chainState);

  return {
    runtimeId: runtime.runtimeId,
    workspaceId: WorkspaceIdSchema.parse(runtime.workspaceId),
    status,
    startedAt: runtime.startedAt.getTime(),
    previewUrl: runtime.previewUrl,
    terminalSessionId: runtime.terminalSessionId,
    ports: {
      chain: runtime.chainPort,
      compiler: runtime.compilerPort,
      deployer: runtime.deployerPort,
      wallet: runtime.walletPort,
      terminal: runtime.terminalPort,
    },
    chainState: chainState.success ? chainState.data : null,
  };
}

runtimeApi.openapi(runtimeRoute, async (c) => {
  const parsed = { success: true as const, data: c.req.valid('json') };

  if (parsed.data.type === 'open_workspace') {
    const workspace = await prisma.workspace.findUnique({
      where: { id: parsed.data.workspaceId },
      include: { runtime: true },
    });

    if (!workspace) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    try {
      const directoryPath = await provisionWorkspaceDirectory(workspace.id);
      if (workspace.directoryPath !== directoryPath) {
        await prisma.workspace.update({
          where: { id: workspace.id },
          data: { directoryPath },
        });
      }

      const container = await ensureWorkspaceContainer(
        workspace.id,
        workspaceHostPath(workspace.id),
      );

      const runtime = await prisma.workspaceRuntime.upsert({
        where: { workspaceId: workspace.id },
        create: {
          workspaceId: workspace.id,
          status: 'ready',
          startedAt: new Date(container.startedAtMs),
          terminalSessionId: `${workspace.id}-terminal`,
          previewUrl: null,
          chainPort: null,
          compilerPort: null,
          deployerPort: null,
          walletPort: null,
          terminalPort: null,
          chainState: Prisma.JsonNull,
        },
        update: {
          status: 'ready',
          startedAt: new Date(container.startedAtMs),
          terminalSessionId: `${workspace.id}-terminal`,
        },
      });

      const response = RuntimeResponseSchema.parse({
        correlationId: parsed.data.correlationId,
        type: 'open_workspace',
        descriptor: toDescriptor(runtime),
      });

      return c.json(response, 200);
    } catch (error) {
      return c.json(
        createApiErrorBody(
          'runtime_unavailable',
          error instanceof Error ? error.message : 'Failed to start runtime container',
        ),
        503,
      );
    }
  }

  if (parsed.data.type === 'runtime_status') {
    const runtimes = await prisma.workspaceRuntime.findMany();
    const reconciled = await Promise.all(
      runtimes.map(async (runtime) => {
        const state = await getWorkspaceContainerState(runtime.workspaceId).catch(() => 'missing');
        const expectedStopped = state === 'missing' || state === 'stopped';

        if (expectedStopped && runtime.status !== 'stopped') {
          return prisma.workspaceRuntime.update({
            where: { runtimeId: runtime.runtimeId },
            data: {
              status: 'stopped',
              previewUrl: null,
              terminalSessionId: null,
              chainPort: null,
              compilerPort: null,
              deployerPort: null,
              walletPort: null,
              terminalPort: null,
              chainState: Prisma.JsonNull,
            },
          });
        }

        return runtime;
      }),
    );

    const descriptors = reconciled.map(toDescriptor);
    const response = RuntimeResponseSchema.parse({
      correlationId: parsed.data.correlationId,
      type: 'runtime_status',
      descriptors,
    });
    return c.json(response, 200);
  }

  if (parsed.data.type === 'close_workspace') {
    const workspace = await prisma.workspace.findUnique({
      where: { id: parsed.data.workspaceId },
      include: { runtime: true },
    });

    if (!workspace) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    try {
      await stopWorkspaceContainer(workspace.id);

      if (workspace.runtime) {
        await prisma.workspaceRuntime.update({
          where: { workspaceId: workspace.id },
          data: {
            status: 'stopped',
            previewUrl: null,
            terminalSessionId: null,
            chainPort: null,
            compilerPort: null,
            deployerPort: null,
            walletPort: null,
            terminalPort: null,
            chainState: Prisma.JsonNull,
          },
        });
      }

      const response = RuntimeResponseSchema.parse({
        correlationId: parsed.data.correlationId,
        type: 'close_workspace',
        ok: true,
      });

      return c.json(response, 200);
    } catch (error) {
      return c.json(
        createApiErrorBody(
          'runtime_unavailable',
          error instanceof Error ? error.message : 'Failed to close runtime container',
        ),
        503,
      );
    }
  }

  if (parsed.data.type === 'tool_exec') {
    const workspace = await prisma.workspace.findUnique({
      where: { id: parsed.data.workspaceId },
      select: { id: true },
    });

    if (!workspace) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    const outcome = await executeRuntimeTool({
      workspaceId: workspace.id,
      server: parsed.data.server,
      tool: parsed.data.tool,
      args: parsed.data.args,
    }).catch((error) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : 'Failed to execute runtime tool',
    }));

    const response = RuntimeResponseSchema.parse({
      correlationId: parsed.data.correlationId,
      type: 'tool_exec',
      outcome,
    });
    return c.json(response, 200);
  }

  return c.json(createApiErrorBody('bad_request', 'Runtime request type is not implemented'), 501);
});
