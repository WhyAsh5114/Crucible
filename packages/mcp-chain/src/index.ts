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
import { localhostHostValidation } from '@modelcontextprotocol/hono';
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
import { startNode, forkNode, requireNode, rpc } from './node-manager.ts';
import { createChainServer } from './server.ts';

const PORT = process.env['CHAIN_MCP_PORT']
  ? parseInt(process.env['CHAIN_MCP_PORT'], 10)
  : mcp.DEFAULT_MCP_PORTS.chain;

console.log(`[mcp-chain] starting on port ${PORT}`);

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

const mcpServer = createChainServer();

type Env = { Variables: { parsedBody: unknown } };

const transport = new WebStandardStreamableHTTPServerTransport();
await mcpServer.connect(transport);

const app = new OpenAPIHono<Env>();

// DNS rebinding protection.
app.use('*', localhostHostValidation());

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

// REST route handlers
app.openapi(startNodeRoute, async (c) => {
  try {
    const body = c.req.valid('json');
    const node = await startNode(body ?? {});
    return c.json({ rpcUrl: node.rpcUrl, chainId: node.chainId }, 200);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(getStateRoute, async (c) => {
  try {
    const node = requireNode();
    const [rawBlock, rawGasPrice, accounts] = await Promise.all([
      rpc<string>(node.rpcUrl, 'eth_blockNumber'),
      rpc<string>(node.rpcUrl, 'eth_gasPrice'),
      rpc<string[]>(node.rpcUrl, 'eth_accounts'),
    ]);
    return c.json(
      {
        chainId: node.chainId,
        blockNumber: parseInt(rawBlock, 16),
        gasPrice: encodeBigInt(BigInt(rawGasPrice)),
        accounts,
        isForked: node.isForked,
        ...(node.forkBlock !== undefined ? { forkBlock: node.forkBlock } : {}),
        activeSnapshotIds: node.snapshotIds,
      },
      200,
    );
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(snapshotRoute, async (c) => {
  try {
    const node = requireNode();
    const snapshotId = await rpc<string>(node.rpcUrl, 'evm_snapshot');
    node.snapshotIds.push(snapshotId);
    return c.json({ snapshotId }, 200);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(revertRoute, async (c) => {
  try {
    const { snapshotId } = c.req.valid('json');
    const node = requireNode();
    const success = await rpc<boolean>(node.rpcUrl, 'evm_revert', [snapshotId]);
    const idx = node.snapshotIds.indexOf(snapshotId);
    if (idx !== -1) node.snapshotIds.splice(idx);
    return c.json({ success }, 200);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(mineRoute, async (c) => {
  try {
    const { blocks } = c.req.valid('json');
    const node = requireNode();
    await rpc(node.rpcUrl, 'hardhat_mine', [`0x${blocks.toString(16)}`]);
    const rawBlock = await rpc<string>(node.rpcUrl, 'eth_blockNumber');
    return c.json({ newBlockNumber: parseInt(rawBlock, 16) }, 200);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(forkRoute, async (c) => {
  try {
    const input = c.req.valid('json');
    const node = requireNode();
    await forkNode(node.rpcUrl, {
      rpcUrl: input.rpcUrl,
      ...(input.blockNumber !== undefined ? { blockNumber: input.blockNumber } : {}),
    });
    node.isForked = true;
    node.snapshotIds = [];
    if (input.blockNumber !== undefined) {
      node.forkBlock = input.blockNumber;
    } else {
      delete node.forkBlock;
    }
    return c.json({ rpcUrl: node.rpcUrl, chainId: node.chainId }, 200);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
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
