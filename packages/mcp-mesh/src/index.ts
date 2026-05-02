/**
 * mcp-mesh entry point.
 *
 * Starts the AXL node binary, waits for it to be ready, then starts an
 * OpenAPIHono HTTP server on DEFAULT_MCP_PORTS.mesh (3105) or the port
 * specified by MESH_MCP_PORT.
 *
 * Exposes both:
 *   POST /mcp   — MCP protocol transport
 *   REST routes — typed endpoints consumable via tool-exec proxy
 *
 * Environment flags:
 *   MESH_MCP_PORT=N       — override the listen port (default 3105)
 *   WORKSPACE_ROOT=<path> — workspace root for key/config storage (defaults to cwd)
 *   AXL_NODE_PATH=<path>  — override path to the axl-node binary
 *   AXL_API_PORT=N        — override AXL's local HTTP API port (default 9002)
 *   ALLOWED_HOSTS=<csv>   — extra hostnames for host-header validation
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
  BroadcastHelpInputSchema,
  CollectResponsesInputSchema,
  RespondInputSchema,
  VerifyPeerPatchInputSchema,
} from '@crucible/types/mcp/mesh';
import { AXLNodeManager } from './node-manager.ts';
import { createMeshServer } from './server.ts';

const PORT = process.env['MESH_MCP_PORT']
  ? parseInt(process.env['MESH_MCP_PORT'], 10)
  : mcp.DEFAULT_MCP_PORTS.mesh;

const WORKSPACE_ROOT = process.env['WORKSPACE_ROOT'] ?? process.cwd();
const devtools = createDevtoolsReporter('mesh');

console.log(`[mcp-mesh] starting on port ${PORT} (workspaceRoot: ${WORKSPACE_ROOT})`);

// Boot the AXL node — this must succeed before we serve any requests.
const manager = new AXLNodeManager(WORKSPACE_ROOT);
await manager.start();

// Register shutdown handler so the AXL child process is cleaned up.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`[mcp-mesh] received ${sig} — stopping AXL node`);
    void manager.stop().then(() => process.exit(0));
  });
}

// ── Wire-format schemas for OpenAPI ───────────────────────────────────────

const ErrorSchema = z.object({ error: z.string() });

const MeshPeerWire = z.object({
  nodeId: z.string(),
  endpoint: z.string().optional(),
  lastSeen: z.number(),
  reputation: z.number(),
});

const ListPeersOutputWire = z.object({ peers: z.array(MeshPeerWire) });
const BroadcastHelpOutputWire = z.object({ reqId: z.string() });
const CollectResponsesOutputWire = z.object({
  responses: z.array(
    z.object({
      reqId: z.string(),
      peerId: z.string(),
      patch: z.string(),
      verificationReceipt: z.string(),
      respondedAt: z.number(),
    }),
  ),
});
const RespondOutputWire = z.object({ ack: z.literal(true) });
const VerifyPeerPatchOutputWire = z.discriminatedUnion('result', [
  z.object({ result: z.literal('verified'), localReceipt: z.string() }),
  z.object({ result: z.literal('failed'), reason: z.string() }),
]);

// ── Route definitions ──────────────────────────────────────────────────────

const listPeersRoute = createRoute({
  method: 'get',
  path: '/peers',
  responses: {
    200: {
      content: { 'application/json': { schema: ListPeersOutputWire } },
      description: 'Peer list',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const broadcastHelpRoute = createRoute({
  method: 'post',
  path: '/broadcast_help',
  request: {
    body: {
      content: { 'application/json': { schema: BroadcastHelpInputSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: BroadcastHelpOutputWire } },
      description: 'Broadcast accepted',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const collectResponsesRoute = createRoute({
  method: 'post',
  path: '/collect_responses',
  request: {
    body: {
      content: { 'application/json': { schema: CollectResponsesInputSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CollectResponsesOutputWire } },
      description: 'Collected responses',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const respondRoute = createRoute({
  method: 'post',
  path: '/respond',
  request: {
    body: {
      content: { 'application/json': { schema: RespondInputSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: RespondOutputWire } },
      description: 'Response sent',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const verifyPeerPatchRoute = createRoute({
  method: 'post',
  path: '/verify_peer_patch',
  request: {
    body: {
      content: { 'application/json': { schema: VerifyPeerPatchInputSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: VerifyPeerPatchOutputWire } },
      description: 'Verification result',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

// ── Server and transport ───────────────────────────────────────────────────

const mcpServer = createMeshServer(manager);
const transport = new WebStandardStreamableHTTPServerTransport();
await mcpServer.connect(transport);

type Env = { Variables: { parsedBody: unknown } };

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
  console.log(`[mcp-mesh] → ${c.req.method} ${path}`);
  await next();
  const ms = Date.now() - start;
  const status = c.res?.status ?? 0;
  const logFn = status >= 500 ? console.error : status >= 400 ? console.warn : console.log;
  logFn(`[mcp-mesh] ← ${status} (${ms}ms)`);
});

// Devtools tracing middleware
function meshToolForPath(path: string): string | null {
  if (path === '/peers') return 'list_peers';
  if (path === '/broadcast_help') return 'broadcast_help';
  if (path === '/collect_responses') return 'collect_responses';
  if (path === '/respond') return 'respond';
  if (path === '/verify_peer_patch') return 'verify_peer_patch';
  return null;
}

app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  let tool = meshToolForPath(path);
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
      if (json?.result?.structuredContent) {
        result = json.result.structuredContent;
      } else if (json?.result?.content?.[0]?.text) {
        try {
          result = JSON.parse(json.result.content[0].text);
        } catch {
          result = json.result;
        }
      } else if (json?.error) {
        result = json.error;
      }
    } else {
      result = json;
    }
  } catch {
    /* non-JSON response */
  }
  void devtools.emitToolResult(tool, ok, result, durationMs);
});

// ── REST route handlers ────────────────────────────────────────────────────

app.openapi(listPeersRoute, async (c) => {
  try {
    const output = await manager.listPeers();
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-mesh] list_peers error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(broadcastHelpRoute, async (c) => {
  try {
    const output = await manager.broadcastHelp(c.req.valid('json'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-mesh] broadcast_help error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(collectResponsesRoute, async (c) => {
  try {
    const output = await manager.collectResponses(c.req.valid('json'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-mesh] collect_responses error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(respondRoute, async (c) => {
  try {
    const output = await manager.respond(c.req.valid('json'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-mesh] respond error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(verifyPeerPatchRoute, async (c) => {
  try {
    const output = manager.verifyPeerPatch(c.req.valid('json'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-mesh] verify_peer_patch error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.all('/mcp', (c) => transport.handleRequest(c.req.raw, { parsedBody: c.get('parsedBody') }));

app.doc('/doc', { openapi: '3.0.0', info: { version: '0.0.0', title: 'crucible-mesh' } });

export type AppType = typeof app;

export default {
  port: PORT,
  fetch: app.fetch,
};
