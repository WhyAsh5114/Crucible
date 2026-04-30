/**
 * Inference router — `POST /api/prompt`.
 *
 * Accepts a user prompt, wires up the `AgentAdapter` from local backend libs,
 * and delegates to `runAgentTurn` from `@crucible/agent`.  The HTTP response
 * is small and synchronous (202 + streamId); token deltas and tool events flow
 * over the existing `/api/agent/stream` SSE feed.
 */

import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import {
  ApiErrorSchema,
  PromptRequestSchema,
  PromptResponseSchema,
  StreamIdSchema,
  type FallbackReason,
} from '@crucible/types';
import { runAgentTurn, type AgentAdapter, type AgentConfig } from '@crucible/agent';
import { prisma } from '../lib/prisma';
import { createApiErrorBody } from '../lib/api-error';
import { nextAgentSeq, publishAgentEvent } from '../lib/agent-bus';
import { collectWorkspaceFiles, workspaceHostPath, writeWorkspaceFile } from '../lib/workspace-fs';
import { getWorkspaceContainerPorts, runtimeServiceBaseUrl } from '../lib/runtime-docker';
import { buildOgAgentConfig } from '../lib/og-adapter';
import { auth } from '../lib/auth';

// ── Config ───────────────────────────────────────────────────────────────────

/**
 * Return the active AgentConfig.
 *
 * 0G Compute Router is tried first when `OG_API_KEY` + `OG_MODEL` are set.
 * Falls back to the OpenAI-compatible endpoint env vars when 0G is unconfigured
 * or when the caller explicitly requests fallback (e.g. retry button after a
 * Router error).
 */
function resolveAgentConfig(
  options: { forceOpenAiFallback?: boolean; fallbackReason?: FallbackReason } = {},
): { ok: true; config: AgentConfig } | { ok: false; reason: string } {
  if (!options.forceOpenAiFallback) {
    const og = buildOgAgentConfig();
    if (og) return { ok: true, config: og };
  }

  // OpenAI-compatible fallback.
  const baseUrl = process.env['OPENAI_BASE_URL'];
  const apiKey = process.env['OPENAI_API_KEY'];
  const model = process.env['OPENAI_MODEL'];
  if (!baseUrl) return { ok: false, reason: 'OPENAI_BASE_URL is not set' };
  if (!apiKey) return { ok: false, reason: 'OPENAI_API_KEY is not set' };
  if (!model) return { ok: false, reason: 'OPENAI_MODEL is not set' };
  return {
    ok: true,
    config: {
      baseUrl: baseUrl.replace(/\/+$/u, ''),
      apiKey,
      model,
      provider: 'openai-compatible',
      fallbackReason: options.fallbackReason ?? 'admin_override',
    },
  };
}

// ── AgentAdapter implementation ──────────────────────────────────────────────

function buildAdapter(): AgentAdapter {
  return {
    getWorkspaceFiles: async (workspaceId) => {
      const ws = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { directoryPath: true },
      });
      const dir =
        ws?.directoryPath && !ws.directoryPath.startsWith('pending://')
          ? ws.directoryPath
          : workspaceHostPath(workspaceId);
      return collectWorkspaceFiles(dir);
    },

    writeFile: async (workspaceId, filePath, content) =>
      writeWorkspaceFile(workspaceId, filePath, content),

    publishEvent: (workspaceId, event) => publishAgentEvent(workspaceId, event),

    nextSeq: (workspaceId) => nextAgentSeq(workspaceId),
  };
}

// ── Fire-and-forget orchestration ────────────────────────────────────────────

async function runInference(
  workspaceId: string,
  prompt: string,
  options: { forceOpenAiFallback?: boolean } = {},
): Promise<void> {
  const force = options.forceOpenAiFallback ?? false;
  const resolved = resolveAgentConfig(
    force ? { forceOpenAiFallback: true, fallbackReason: 'admin_override' } : {},
  );
  const streamId = StreamIdSchema.parse(workspaceId);

  if (!resolved.ok) {
    const seq = nextAgentSeq(workspaceId);
    publishAgentEvent(workspaceId, {
      streamId,
      seq,
      emittedAt: Date.now(),
      type: 'error',
      message: `Inference unavailable: ${resolved.reason}`,
    });
    publishAgentEvent(workspaceId, {
      streamId,
      seq: nextAgentSeq(workspaceId),
      emittedAt: Date.now(),
      type: 'done',
    });
    return;
  }

  // Build MCP server URLs from the live container port map.
  const mcpServerUrls: Partial<
    Record<'chain' | 'compiler' | 'deployer' | 'wallet' | 'memory' | 'terminal', string>
  > = {};
  try {
    const ports = await getWorkspaceContainerPorts(workspaceId);
    if (ports) {
      for (const key of [
        'chain',
        'compiler',
        'deployer',
        'wallet',
        'memory',
        'terminal',
      ] as const) {
        const port = ports[key];
        if (port !== null) mcpServerUrls[key] = `${runtimeServiceBaseUrl(port)}/mcp`;
      }
    }
  } catch {
    // Container not running yet — agent will degrade without MCP tools.
  }

  await runAgentTurn(workspaceId, prompt, { ...resolved.config, mcpServerUrls }, buildAdapter());
}

// ── OpenAPI route definition ─────────────────────────────────────────────────

const promptRoute = createRoute({
  method: 'post',
  path: '/prompt',
  request: {
    body: {
      content: { 'application/json': { schema: PromptRequestSchema } },
      required: true,
    },
  },
  responses: {
    202: {
      content: { 'application/json': { schema: PromptResponseSchema } },
      description: 'Inference accepted; subscribe to /api/agent/stream',
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
    503: {
      content: { 'application/json': { schema: ApiErrorSchema } },
      description: 'Inference provider unavailable',
    },
  },
});

// ── Router ───────────────────────────────────────────────────────────────────

export const inferenceApi = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        createApiErrorBody('bad_request', result.error.issues[0]?.message ?? 'Validation failed'),
        400,
      );
    }
    return undefined;
  },
}).openapi(promptRoute, async (c) => {
  const { workspaceId, prompt, force_openai_fallback: forceOpenAiFallback } = c.req.valid('json');

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const userId = session?.user.id ?? null;

  if (!userId) {
    return c.json(createApiErrorBody('unauthorized', 'Authentication required'), 401);
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, userId: true },
  });
  if (!workspace) {
    return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
  }
  if (workspace.userId !== userId) {
    return c.json(createApiErrorBody('not_found', 'Workspace not found'), 404);
  }

  // Kick off in the background; the caller is expected to be subscribed to
  // /api/agent/stream already.
  void runInference(workspaceId, prompt, forceOpenAiFallback ? { forceOpenAiFallback: true } : {});

  return c.json(PromptResponseSchema.parse({ streamId: StreamIdSchema.parse(workspaceId) }), 202);
});
