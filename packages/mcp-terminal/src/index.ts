/**
 * mcp-terminal entry point.
 *
 * Starts an OpenAPIHono HTTP server on DEFAULT_MCP_PORTS.terminal (3106) or
 * the port specified by the TERMINAL_MCP_PORT environment variable.
 *
 * Exposes both:
 *   POST /mcp              — MCP protocol transport (hidden from OpenAPI docs)
 *   REST routes            — typed endpoints for the backend tool-exec proxy
 *
 * REST surface (all POST, JSON in/out):
 *   POST /create_session   — get-or-create workspace bash session
 *   POST /write            — send raw text to session stdin
 *   POST /exec             — run a command and capture stdout/stderr/exitCode
 *   POST /resize           — update session terminal dimensions
 *
 * Environment flags:
 *   TERMINAL_MCP_PORT=N    — override the listen port (default: 3106)
 *   WORKSPACE_ROOT=<path>  — workspace root directory (default: /workspace)
 *   ALLOWED_HOSTS=h1,h2    — additional allowed Host headers for DNS-rebinding protection
 */

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
  CreateSessionInputSchema,
  CreateSessionOutputSchema,
  WriteInputSchema,
  WriteOutputSchema,
  ExecInputSchema,
  ExecOutputSchema,
  ResizeInputSchema,
  ResizeOutputSchema,
  type CreateSessionOutput,
} from '@crucible/types/mcp/terminal';
import { createTerminalServer } from './server.ts';
import { createSession, writeSession, execCommand, resizeSession } from './session-helpers.ts';

// ── Config ────────────────────────────────────────────────────────────────────

const PORT = process.env['TERMINAL_MCP_PORT']
  ? parseInt(process.env['TERMINAL_MCP_PORT'], 10)
  : mcp.DEFAULT_MCP_PORTS.terminal;

const WORKSPACE_ROOT = process.env['WORKSPACE_ROOT'] ?? '/workspace';

const devtools = createDevtoolsReporter('terminal');

console.log(`[mcp-terminal] starting on port ${PORT} (workspaceRoot: ${WORKSPACE_ROOT})`);

// ── Error schema ──────────────────────────────────────────────────────────────

const ErrorSchema = z.object({ error: z.string() });

// ── OpenAPI route definitions ─────────────────────────────────────────────────

const createSessionRoute = createRoute({
  method: 'post',
  path: '/create_session',
  request: {
    body: {
      content: { 'application/json': { schema: CreateSessionInputSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CreateSessionOutputSchema } },
      description: 'Session metadata',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Internal error',
    },
  },
});

const writeRoute = createRoute({
  method: 'post',
  path: '/write',
  request: {
    body: {
      content: { 'application/json': { schema: WriteInputSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: WriteOutputSchema } },
      description: 'Write acknowledged',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Session not found',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Internal error',
    },
  },
});

const execRoute = createRoute({
  method: 'post',
  path: '/exec',
  request: {
    body: {
      content: { 'application/json': { schema: ExecInputSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ExecOutputSchema } },
      description: 'Command output',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Internal error',
    },
  },
});

const resizeRoute = createRoute({
  method: 'post',
  path: '/resize',
  request: {
    body: {
      content: { 'application/json': { schema: ResizeInputSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ResizeOutputSchema } },
      description: 'Resize acknowledged',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Session not found',
    },
    500: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Internal error',
    },
  },
});

// ── MCP server + transport ────────────────────────────────────────────────────

// The MCP server registers tools that call the same session-helpers functions
// as the REST handlers, ensuring shared in-process state across both paths.
const mcpServer = createTerminalServer({ workspaceRoot: WORKSPACE_ROOT });

type Env = { Variables: { parsedBody: unknown } };

const transport = new WebStandardStreamableHTTPServerTransport();
await mcpServer.connect(transport);

// ── Hono app ──────────────────────────────────────────────────────────────────

const app = new OpenAPIHono<Env>();

// DNS-rebinding protection.
const extraHosts = process.env['ALLOWED_HOSTS']
  ? process.env['ALLOWED_HOSTS']
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean)
  : [];
app.use('*', hostHeaderValidation(['localhost', '127.0.0.1', '::1', '[::1]', ...extraHosts]));

// Parse JSON bodies once and stash them for the MCP transport.
app.use('*', async (c, next) => {
  if (c.req.header('content-type')?.includes('application/json')) {
    try {
      c.set('parsedBody', await c.req.json<unknown>());
    } catch {
      // non-JSON or empty body — ignore
    }
  }
  await next();
});

// Request logger (skips /doc).
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/doc') {
    await next();
    return;
  }
  const start = Date.now();
  console.log(`[mcp-terminal] \u2192 ${c.req.method} ${path}`);
  await next();
  const ms = Date.now() - start;
  const status = c.res?.status ?? 0;
  const logFn = status >= 500 ? console.error : status >= 400 ? console.warn : console.log;
  logFn(`[mcp-terminal] \u2190 ${status} (${ms}ms)`);
});

// Devtools reporting — emit tool_call + tool_result events to mcp-devtools.
function terminalToolForPath(path: string): string | null {
  if (path === '/create_session') return 'create_session';
  if (path === '/write') return 'write';
  if (path === '/exec') return 'exec';
  if (path === '/resize') return 'resize';
  return null;
}

app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  let tool = terminalToolForPath(path);
  let args: unknown = {};

  if (path === '/mcp') {
    const body = c.get('parsedBody') as McpToolsCallBody | undefined;
    if (body?.method === 'tools/call' && body?.params?.name) {
      tool = body.params.name;
      args = body.params.arguments ?? {};
    }
  } else if (tool) {
    args = c.get('parsedBody');
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
    // Non-JSON responses still get traced with status only.
  }
  void devtools.emitToolResult(tool, ok, result, durationMs);
});

// ── REST route handlers ───────────────────────────────────────────────────────

app.openapi(createSessionRoute, async (c) => {
  try {
    const { workspaceId, cols, rows } = c.req.valid('json');
    const raw = createSession(workspaceId, cols, rows, WORKSPACE_ROOT);
    // Parse through the output schema to apply branded-string types that
    // OpenAPIHono's type checker requires (TerminalSessionId, WorkspaceId).
    const session = CreateSessionOutputSchema.parse(raw) as CreateSessionOutput;
    return c.json(session, 200);
  } catch (err) {
    console.error(`[mcp-terminal] create_session error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(writeRoute, async (c) => {
  try {
    const { sessionId, text } = c.req.valid('json');
    const ok = await writeSession(sessionId, text, WORKSPACE_ROOT);
    if (!ok) {
      return c.json({ error: `Session "${sessionId}" not found. Call create_session first.` }, 404);
    }
    return c.json({ success: true as const }, 200);
  } catch (err) {
    console.error(`[mcp-terminal] write error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(execRoute, async (c) => {
  try {
    const { sessionId, command, cwd, env, timeoutMs } = c.req.valid('json');
    const result = await execCommand(sessionId, command, cwd, env, timeoutMs, WORKSPACE_ROOT);
    return c.json(result, 200);
  } catch (err) {
    console.error(`[mcp-terminal] exec error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(resizeRoute, async (c) => {
  try {
    const { sessionId, cols, rows } = c.req.valid('json');
    const ok = resizeSession(sessionId, cols, rows);
    if (!ok) {
      return c.json({ error: `Session "${sessionId}" not found. Call create_session first.` }, 404);
    }
    return c.json({ success: true as const }, 200);
  } catch (err) {
    console.error(`[mcp-terminal] resize error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

// MCP protocol endpoint (hidden from OpenAPI spec).
app.all('/mcp', (c) => transport.handleRequest(c.req.raw, { parsedBody: c.get('parsedBody') }));

// OpenAPI spec endpoint.
app.doc('/doc', { openapi: '3.0.0', info: { version: '0.0.0', title: 'crucible-terminal' } });

// Export typed app for future hc<AppType> use.
export type AppType = typeof app;

export default {
  port: PORT,
  fetch: app.fetch,
};
