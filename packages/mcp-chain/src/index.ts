/**
 * mcp-chain entry point.
 *
 * Starts an OpenAPIHono HTTP server on DEFAULT_MCP_PORTS.chain (3100) or the
 * port specified by the CHAIN_MCP_PORT environment variable.
 *
 * Exposes both:
 *   POST /mcp   — MCP protocol transport (hidden from OpenAPI docs)
 *   REST routes — typed endpoints consumable via hc<AppType> from the frontend
 *
 * Environment flags:
 *   CHAIN_MCP_PORT=N    — override the listen port
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { hostHeaderValidation } from '@modelcontextprotocol/hono';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { mcp, encodeBigInt } from '@crucible/types';
import {
  StartNodeInputSchema,
  StartNodeOutputSchema,
  RevertInputSchema,
  RevertOutputSchema,
  MineInputSchema,
  MineOutputSchema,
  ForkInputSchema,
  ForkOutputSchema,
} from '@crucible/types/mcp/chain';
import { startNode, requireNode, rpc } from './node-manager.ts';
import { createChainServer } from './server.ts';

const PORT = process.env['CHAIN_MCP_PORT']
  ? parseInt(process.env['CHAIN_MCP_PORT'], 10)
  : mcp.DEFAULT_MCP_PORTS.chain;

const WORKSPACE_ID = process.env['WORKSPACE_ID'] ?? 'default';
const DEFAULT_FORK_RPC_URL = process.env['DEFAULT_FORK_RPC_URL'];

console.log(`[mcp-chain] starting on port ${PORT} (workspaceId: ${WORKSPACE_ID})`);
if (DEFAULT_FORK_RPC_URL) {
  console.log(`[mcp-chain] default fork RPC: ${DEFAULT_FORK_RPC_URL}`);
}

// ── Error schema ────────────────────────────────────────────────────────────

const ErrorSchema = z.object({ error: z.string() });

// ── OpenAPI routes ──────────────────────────────────────────────────────────

const startNodeRoute = createRoute({
  method: 'post',
  path: '/start_node',
  request: {
    body: { content: { 'application/json': { schema: StartNodeInputSchema } }, required: false },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: StartNodeOutputSchema } },
      description: 'Node started',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

// Plain wire-format schema — BigIntStringSchema's output is `bigint` (not JSON-safe)
// and AddressSchema/SnapshotIdSchema are branded, so we use literal primitive types here.
const ChainStateWireSchema = z.object({
  chainId: z.number(),
  blockNumber: z.number(),
  gasPrice: z.string(),
  accounts: z.array(z.string()),
  isForked: z.boolean(),
  forkBlock: z.number().optional(),
  activeSnapshotIds: z.array(z.string()),
});

const getStateRoute = createRoute({
  method: 'get',
  path: '/state',
  responses: {
    200: {
      content: { 'application/json': { schema: ChainStateWireSchema } },
      description: 'Chain state',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const snapshotRoute = createRoute({
  method: 'post',
  path: '/snapshot',
  responses: {
    // SnapshotIdSchema is branded; use plain string for the wire format
    200: {
      content: { 'application/json': { schema: z.object({ snapshotId: z.string() }) } },
      description: 'Snapshot taken',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const revertRoute = createRoute({
  method: 'post',
  path: '/revert',
  request: {
    body: { content: { 'application/json': { schema: RevertInputSchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: RevertOutputSchema } },
      description: 'Reverted',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const mineRoute = createRoute({
  method: 'post',
  path: '/mine',
  request: {
    body: { content: { 'application/json': { schema: MineInputSchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: MineOutputSchema } },
      description: 'Blocks mined',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const forkRoute = createRoute({
  method: 'post',
  path: '/fork',
  request: {
    body: { content: { 'application/json': { schema: ForkInputSchema } }, required: true },
  },
  responses: {
    200: { content: { 'application/json': { schema: ForkOutputSchema } }, description: 'Forked' },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

// ── App ─────────────────────────────────────────────────────────────────────

const mcpServer = createChainServer(WORKSPACE_ID, {
  ...(DEFAULT_FORK_RPC_URL ? { defaultForkRpcUrl: DEFAULT_FORK_RPC_URL } : {}),
});

type Env = { Variables: { parsedBody: unknown } };

const transport = new WebStandardStreamableHTTPServerTransport();
await mcpServer.connect(transport);

const app = new OpenAPIHono<Env>();

// DNS rebinding protection — localhost plus any extra hosts from ALLOWED_HOSTS env var.
// ALLOWED_HOSTS accepts a comma-separated list, e.g. ALLOWED_HOSTS=macbook,100.x.y.z
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
      // non-JSON or empty body
    }
  }
  await next();
});

// Incoming request logger — logs method, path, status, and round-trip duration (skips /doc).
app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path === '/doc') {
    await next();
    return;
  }
  const start = Date.now();
  console.log(`[mcp-chain] \u2192 ${c.req.method} ${path}`);
  await next();
  const ms = Date.now() - start;
  const status = c.res?.status ?? 0;
  const logFn = status >= 500 ? console.error : status >= 400 ? console.warn : console.log;
  logFn(`[mcp-chain] \u2190 ${status} (${ms}ms)`);
});

// REST route handlers
app.openapi(startNodeRoute, async (c) => {
  try {
    const body = c.req.valid('json') ?? {};
    // Inject the server-level default fork RPC if the caller omitted it.
    const input =
      body.fork && !body.fork.rpcUrl && DEFAULT_FORK_RPC_URL
        ? { ...body, fork: { ...body.fork, rpcUrl: DEFAULT_FORK_RPC_URL } }
        : body;
    const node = await startNode(WORKSPACE_ID, input);
    console.log(`[mcp-chain] start_node ok  rpcUrl=${node.rpcUrl} chainId=${node.chainId}`);
    return c.json({ rpcUrl: node.rpcUrl, chainId: node.chainId }, 200);
  } catch (err) {
    console.error(`[mcp-chain] start_node error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(getStateRoute, async (c) => {
  try {
    const node = requireNode(WORKSPACE_ID);
    const [rawBlock, rawGasPrice, accounts] = await Promise.all([
      rpc<string>(node.rpcUrl, 'eth_blockNumber'),
      rpc<string>(node.rpcUrl, 'eth_gasPrice'),
      rpc<string[]>(node.rpcUrl, 'eth_accounts'),
    ]);
    const blockNumber = parseInt(rawBlock, 16);
    console.log(`[mcp-chain] get_state ok  block=${blockNumber} accounts=${accounts.length}`);
    return c.json(
      {
        chainId: node.chainId,
        blockNumber,
        gasPrice: encodeBigInt(BigInt(rawGasPrice)),
        accounts,
        isForked: node.isForked,
        ...(node.forkBlock !== undefined ? { forkBlock: node.forkBlock } : {}),
        activeSnapshotIds: node.snapshotIds,
      },
      200,
    );
  } catch (err) {
    console.error(`[mcp-chain] get_state error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(snapshotRoute, async (c) => {
  try {
    const node = requireNode(WORKSPACE_ID);
    const snapshotId = await rpc<string>(node.rpcUrl, 'evm_snapshot');
    node.snapshotIds.push(snapshotId);
    console.log(`[mcp-chain] snapshot ok  snapshotId=${snapshotId}`);
    return c.json({ snapshotId }, 200);
  } catch (err) {
    console.error(`[mcp-chain] snapshot error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(revertRoute, async (c) => {
  try {
    const { snapshotId } = c.req.valid('json');
    const node = requireNode(WORKSPACE_ID);
    const success = await rpc<boolean>(node.rpcUrl, 'evm_revert', [snapshotId]);
    if (success) {
      const idx = node.snapshotIds.indexOf(snapshotId);
      if (idx !== -1) {
        node.snapshotIds.splice(idx);
      } else {
        node.snapshotIds = [];
      }
    }
    console.log(`[mcp-chain] revert ok  snapshotId=${snapshotId} success=${success}`);
    return c.json({ success }, 200);
  } catch (err) {
    console.error(`[mcp-chain] revert error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(mineRoute, async (c) => {
  try {
    const { blocks } = c.req.valid('json');
    const node = requireNode(WORKSPACE_ID);
    await rpc(node.rpcUrl, 'hardhat_mine', [`0x${blocks.toString(16)}`]);
    const rawBlock = await rpc<string>(node.rpcUrl, 'eth_blockNumber');
    const newBlockNumber = parseInt(rawBlock, 16);
    console.log(`[mcp-chain] mine ok  blocks=${blocks} newBlock=${newBlockNumber}`);
    return c.json({ newBlockNumber }, 200);
  } catch (err) {
    console.error(`[mcp-chain] mine error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(forkRoute, async (c) => {
  try {
    const input = c.req.valid('json');
    const effectiveForkUrl = input.rpcUrl ?? DEFAULT_FORK_RPC_URL;
    if (!effectiveForkUrl)
      return c.json({ error: 'rpcUrl is required (or set DEFAULT_FORK_RPC_URL)' }, 500);
    console.log(
      `[mcp-chain] fork  rpcUrl=${effectiveForkUrl}${
        input.blockNumber !== undefined ? ` blockNumber=${input.blockNumber}` : ''
      }`,
    );
    // hardhat_reset is not supported in Hardhat v3's edr-simulated network.
    // Restart the node with fork configuration instead.
    const node = await startNode(WORKSPACE_ID, {
      fork: {
        rpcUrl: effectiveForkUrl,
        ...(input.blockNumber !== undefined ? { blockNumber: input.blockNumber } : {}),
      },
    });
    console.log(`[mcp-chain] fork ok  rpcUrl=${node.rpcUrl} chainId=${node.chainId}`);
    return c.json({ rpcUrl: node.rpcUrl, chainId: node.chainId }, 200);
  } catch (err) {
    console.error(`[mcp-chain] fork error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

// JSON-RPC proxy — forwards raw JSON-RPC requests to the active Hardhat node.
// mcp-wallet and mcp-deployer use this as their CHAIN_RPC_URL (port 3100/rpc).
app.post('/rpc', async (c) => {
  let node;
  try {
    node = requireNode(WORKSPACE_ID);
  } catch {
    return c.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: 'No active node — call start_node first' },
      },
      503,
    );
  }
  const body = c.get('parsedBody');
  if (!body) {
    return c.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      400,
    );
  }
  const upstream = await fetch(node.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await upstream.json();
  return c.json(data, upstream.status as 200);
});

// MCP protocol endpoint (hidden from OpenAPI spec).
app.all('/mcp', (c) => transport.handleRequest(c.req.raw, { parsedBody: c.get('parsedBody') }));

// OpenAPI spec.
app.doc('/doc', { openapi: '3.0.0', info: { version: '0.0.0', title: 'crucible-chain' } });

// Export typed app for frontend use: import type { AppType } from '@crucible/mcp-chain'
export type AppType = typeof app;

export default {
  port: PORT,
  fetch: app.fetch,
};
