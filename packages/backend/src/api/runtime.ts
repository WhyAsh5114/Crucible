import {
  ChainStateSchema,
  WorkspaceIdSchema,
  RuntimeStatusSchema,
  RuntimeRequestSchema,
  RuntimeResponseSchema,
  ApiErrorSchema,
  CallIdSchema,
  StreamIdSchema,
  TimestampMsSchema,
} from '@crucible/types';
import {
  stopWorkspaceContainer,
  ensureWorkspaceContainer,
  getWorkspaceContainerState,
  getWorkspaceContainerPorts,
} from '../lib/runtime-docker';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { prisma } from '../lib/prisma';
import { Prisma } from '../generated/prisma/client';
import { randomUUID } from 'node:crypto';
import { executeRuntimeTool } from '../lib/tool-exec';
import { createApiErrorBody } from '../lib/api-error';
import { provisionWorkspaceDirectory, workspaceHostPath } from '../lib/workspace-fs';
import { nextAgentSeq, publishAgentEvent, cleanupAgentBus } from '../lib/agent-bus';
import { auth } from '../lib/auth';
import { cleanupWorkspacePty } from '../lib/pty-manager';

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
    401: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Unauthorized',
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

const baseRuntimeApi = new OpenAPIHono({
  // Convert OpenAPIHono's default validator errors into our ApiError shape so
  // clients always see `{ code, message }` regardless of which layer rejected.
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

export const runtimeApi = baseRuntimeApi.openapi(runtimeRoute, async (c) => {
  const parsed = { success: true as const, data: c.req.valid('json') };
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const userId = session?.user.id ?? null;

  if (!userId) {
    return c.json(createApiErrorBody('unauthorized', 'Authentication required'), 401);
  }

  if (parsed.data.type === 'open_workspace') {
    const workspace = await prisma.workspace.findUnique({
      where: { id: parsed.data.workspaceId },
      include: { runtime: true },
    });

    if (!workspace) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    if (workspace.userId !== userId) {
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

      // Mark the runtime as 'starting' so callers polling runtime_status
      // see a meaningful status during container boot.
      await prisma.workspaceRuntime.upsert({
        where: { workspaceId: workspace.id },
        create: {
          workspaceId: workspace.id,
          status: 'starting',
          startedAt: new Date(),
          terminalSessionId: null,
          previewUrl: null,
          chainPort: null,
          compilerPort: null,
          deployerPort: null,
          walletPort: null,
          terminalPort: null,
          chainState: Prisma.JsonNull,
        },
        update: {
          status: 'starting',
          previewUrl: null,
          terminalSessionId: null,
        },
        select: { runtimeId: true },
      });

      const container = await ensureWorkspaceContainer(
        workspace.id,
        workspaceHostPath(workspace.id),
      );

      // Container is confirmed running — transition to ready or degraded
      // depending on whether the in-container MCP services answered HTTP.
      const runtime = await prisma.workspaceRuntime.update({
        where: { workspaceId: workspace.id },
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

      const response = RuntimeResponseSchema.parse({
        correlationId: parsed.data.correlationId,
        type: 'open_workspace',
        descriptor: toDescriptor(runtime),
      });

      return c.json(response, 200);
    } catch (error) {
      // If we left the runtime in 'starting', mark it crashed so the status
      // is not misleading to subsequent runtime_status polls.
      await prisma.workspaceRuntime
        .updateMany({
          where: { workspaceId: workspace.id, status: 'starting' },
          data: { status: 'crashed' },
        })
        .catch(() => undefined);

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
    const runtimes = await prisma.workspaceRuntime.findMany({
      where: {
        workspace: { userId },
      },
    });
    const reconciled = await Promise.all(
      runtimes.map(async (runtime) => {
        const state = await getWorkspaceContainerState(runtime.workspaceId).catch(() => 'missing');
        const containerRunning = state === 'running';

        if (!containerRunning && runtime.status !== 'stopped' && runtime.status !== 'crashed') {
          // Container is gone — use 'crashed' if it was mid-launch, 'stopped' otherwise.
          const newStatus = runtime.status === 'starting' ? 'crashed' : 'stopped';
          return prisma.workspaceRuntime.update({
            where: { runtimeId: runtime.runtimeId },
            data: {
              status: newStatus,
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

        if (containerRunning && runtime.status === 'stopped') {
          // Container was restarted externally — promote back to ready and
          // re-discover the published host ports so tool_exec keeps working.
          const ports = await getWorkspaceContainerPorts(runtime.workspaceId).catch(() => null);
          return prisma.workspaceRuntime.update({
            where: { runtimeId: runtime.runtimeId },
            data: {
              status: 'ready',
              startedAt: new Date(),
              chainPort: ports?.chain ?? null,
              compilerPort: ports?.compiler ?? null,
              deployerPort: ports?.deployer ?? null,
              walletPort: ports?.wallet ?? null,
              terminalPort: ports?.terminal ?? null,
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

    if (workspace.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    try {
      await stopWorkspaceContainer(workspace.id);
      cleanupAgentBus(workspace.id);
      cleanupWorkspacePty(workspace.id);

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
      select: { id: true, userId: true },
    });

    if (!workspace) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    if (workspace.userId !== userId) {
      return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
    }

    const callId = CallIdSchema.parse(`call-${randomUUID()}`);
    const streamId = StreamIdSchema.parse(workspace.id);
    const toolName = `${parsed.data.server}.${parsed.data.tool}`;

    publishAgentEvent(workspace.id, {
      streamId,
      seq: nextAgentSeq(workspace.id),
      emittedAt: TimestampMsSchema.parse(Date.now()),
      type: 'tool_call',
      callId,
      tool: toolName,
      args: parsed.data.args,
    });

    const outcome = await executeRuntimeTool({
      workspaceId: workspace.id,
      server: parsed.data.server,
      tool: parsed.data.tool,
      args: parsed.data.args,
    }).catch((error) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : 'Failed to execute runtime tool',
    }));

    publishAgentEvent(workspace.id, {
      streamId,
      seq: nextAgentSeq(workspace.id),
      emittedAt: TimestampMsSchema.parse(Date.now()),
      type: 'tool_result',
      callId,
      outcome,
    });

    const response = RuntimeResponseSchema.parse({
      correlationId: parsed.data.correlationId,
      type: 'tool_exec',
      outcome,
    });
    return c.json(response, 200);
  }

  return c.json(createApiErrorBody('bad_request', 'Runtime request type is not implemented'), 501);
});
