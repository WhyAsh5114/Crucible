/**
 * mcp-memory entry point.
 *
 * Starts an OpenAPIHono HTTP server on DEFAULT_MCP_PORTS.memory (3104) or
 * the port specified by MEMORY_MCP_PORT.
 *
 * Exposes both:
 *   POST /mcp   — MCP protocol transport (hidden from OpenAPI docs)
 *   REST routes — typed endpoints consumable via hc<AppType> from the frontend
 *
 * Environment flags:
 *   MEMORY_MCP_PORT=N     — override the listen port
 *   WORKSPACE_ROOT=<path> — workspace root for .crucible/memory storage (defaults to cwd)
 */

import { existsSync } from 'node:fs';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { hostHeaderValidation } from '@modelcontextprotocol/hono';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  mcp,
  createDevtoolsReporter,
  type McpToolsCallBody,
  type McpResponseBody,
} from '@crucible/types';
import {
  RecallInputSchema,
  RememberInputSchema,
  ListPatternsInputSchema,
  ProvenanceInputSchema,
  PurgeInputSchema,
} from '@crucible/types/mcp/memory';
import { createMemoryServer } from './server.ts';
import { createMemoryService } from './service.ts';

const PORT = process.env['MEMORY_MCP_PORT']
  ? parseInt(process.env['MEMORY_MCP_PORT'], 10)
  : mcp.DEFAULT_MCP_PORTS.memory;

const WORKSPACE_ROOT = process.env['WORKSPACE_ROOT'] ?? process.cwd();
const devtools = createDevtoolsReporter('memory');

console.log(`[mcp-memory] starting on port ${PORT} (workspaceRoot: ${WORKSPACE_ROOT})`);

if (!existsSync(WORKSPACE_ROOT)) {
  throw new Error(`[mcp-memory] WORKSPACE_ROOT does not exist: ${WORKSPACE_ROOT}`);
}

const service = createMemoryService({ workspaceRoot: WORKSPACE_ROOT });

const ErrorSchema = z.object({ error: z.string() });

// Wire-format schemas (no branded outputs) for OpenAPI route typing.
const MemoryProvenanceWireSchema = z.object({
  authorNode: z.string(),
  originalSession: z.string(),
  derivedFrom: z.array(z.string()).optional(),
});

const MemoryPatternWireSchema = z.object({
  id: z.string(),
  revertSignature: z.string(),
  patch: z.string(),
  traceRef: z.string(),
  verificationReceipt: z.string(),
  provenance: MemoryProvenanceWireSchema,
  scope: z.enum(['local', 'mesh']),
  createdAt: z.number().int().nonnegative(),
});

const RecallOutputWireSchema = z.object({
  hits: z.array(
    z.object({
      pattern: MemoryPatternWireSchema,
      score: z.number().min(0).max(1),
    }),
  ),
});

const PurgeOutputWireSchema = z.object({ deleted: z.number().int().nonnegative() });

const RememberOutputWireSchema = z.object({ id: z.string() });

const ListPatternsOutputWireSchema = z.object({
  patterns: z.array(MemoryPatternWireSchema),
  nextCursor: z.string().nullable(),
});

const recallRoute = createRoute({
  method: 'post',
  path: '/recall',
  request: {
    body: { content: { 'application/json': { schema: RecallInputSchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: RecallOutputWireSchema } },
      description: 'Recall matches',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const rememberRoute = createRoute({
  method: 'post',
  path: '/remember',
  request: {
    body: { content: { 'application/json': { schema: RememberInputSchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: RememberOutputWireSchema } },
      description: 'Stored pattern id',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const listPatternsRoute = createRoute({
  method: 'get',
  path: '/patterns',
  request: { query: ListPatternsInputSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: ListPatternsOutputWireSchema } },
      description: 'Pattern page',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const provenanceRoute = createRoute({
  method: 'get',
  path: '/provenance/{id}',
  request: { params: ProvenanceInputSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: MemoryProvenanceWireSchema } },
      description: 'Pattern provenance',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const purgeRoute = createRoute({
  method: 'delete',
  path: '/patterns',
  request: { query: PurgeInputSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: PurgeOutputWireSchema } },
      description: 'Number of patterns deleted',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const mcpServer = createMemoryServer({ workspaceRoot: WORKSPACE_ROOT, service });

type Env = { Variables: { parsedBody: unknown } };

const transport = new WebStandardStreamableHTTPServerTransport();
await mcpServer.connect(transport);

const app = new OpenAPIHono<Env>();

const extraHosts = process.env['ALLOWED_HOSTS']
  ? process.env['ALLOWED_HOSTS']
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean)
  : [];
app.use('*', hostHeaderValidation(['localhost', '127.0.0.1', '::1', '[::1]', ...extraHosts]));

app.use('*', async (c, next) => {
  if (c.req.header('content-type')?.includes('application/json')) {
    try {
      c.set('parsedBody', await c.req.json<unknown>());
    } catch {
      // non-JSON or empty body
    }
  }
  await next();
});

app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/doc') {
    await next();
    return;
  }
  const start = Date.now();
  console.log(`[mcp-memory] → ${c.req.method} ${path}`);
  await next();
  const ms = Date.now() - start;
  const status = c.res?.status ?? 0;
  const logFn = status >= 500 ? console.error : status >= 400 ? console.warn : console.log;
  logFn(`[mcp-memory] ← ${status} (${ms}ms)`);
});

function memoryToolForPath(path: string, method?: string): string | null {
  if (path === '/recall') return 'recall';
  if (path === '/remember') return 'remember';
  if (path === '/patterns' && method === 'DELETE') return 'purge';
  if (path === '/patterns') return 'list_patterns';
  if (path.startsWith('/provenance/')) return 'provenance';
  return null;
}

app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  let tool = memoryToolForPath(path, c.req.method);
  let args: unknown = {};

  if (path === '/mcp') {
    const body = c.get('parsedBody') as McpToolsCallBody | undefined;
    if (body?.method === 'tools/call' && body?.params?.name) {
      tool = body.params.name;
      args = body.params.arguments ?? {};
    }
  } else if (tool) {
    args = c.req.method === 'GET' ? {} : c.get('parsedBody');
  }

  if (!tool) {
    await next();
    return;
  }

  const startedAt = Date.now();
  void devtools.emitToolCall(tool, args ?? {});
  await next();

  const durationMs = Date.now() - startedAt;
  const ok = (c.res?.status ?? 500) < 400;
  let result: unknown = { status: c.res?.status ?? 0 };

  try {
    const json = (await c.res.clone().json()) as McpResponseBody;
    if (path === '/mcp') {
      if (json?.result) {
        if (json.result.structuredContent) {
          result = json.result.structuredContent;
        } else if (json.result.content?.[0]?.text) {
          try {
            result = JSON.parse(json.result.content[0].text);
          } catch {
            result = json.result;
          }
        } else {
          result = json.result;
        }
      } else if (json?.error) {
        result = json.error;
      } else {
        result = json;
      }
    } else {
      result = json;
    }
  } catch {
    // Non-JSON responses still get traced with status.
  }
  void devtools.emitToolResult(tool, ok, result, durationMs);
});

app.openapi(recallRoute, async (c) => {
  try {
    const output = await service.recall(c.req.valid('json'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-memory] recall error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(rememberRoute, async (c) => {
  try {
    const output = await service.remember(c.req.valid('json'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-memory] remember error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(listPatternsRoute, async (c) => {
  try {
    const output = await service.listPatterns(c.req.valid('query'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-memory] list_patterns error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(provenanceRoute, async (c) => {
  try {
    const output = await service.provenance(c.req.valid('param'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-memory] provenance error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(purgeRoute, async (c) => {
  try {
    const output = await service.purge(c.req.valid('query'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-memory] purge error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.all('/mcp', (c) => transport.handleRequest(c.req.raw, { parsedBody: c.get('parsedBody') }));

app.doc('/doc', { openapi: '3.0.0', info: { version: '0.0.0', title: 'crucible-memory' } });

export type AppType = typeof app;

export default {
  port: PORT,
  fetch: app.fetch,
};
