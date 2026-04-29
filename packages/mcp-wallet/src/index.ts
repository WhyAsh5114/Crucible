/**
 * mcp-wallet entry point.
 *
 * Starts an OpenAPIHono HTTP server on DEFAULT_MCP_PORTS.wallet (3103) or
 * the port specified by WALLET_MCP_PORT.
 *
 * Exposes both:
 *   POST /mcp   — MCP protocol transport (hidden from OpenAPI docs)
 *   REST routes — typed endpoints consumable via hc<AppType> from the frontend
 *
 * Environment flags:
 *   WALLET_MCP_PORT=N     — override the listen port
 *   CHAIN_RPC_URL=<url>   — chain RPC endpoint (defaults to http://localhost:3100)
 *   WORKSPACE_ROOT=<path> — workspace root for .crucible/state.json (defaults to cwd)
 */

import { existsSync } from 'node:fs';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { hostHeaderValidation } from '@modelcontextprotocol/hono';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { mcp, createDevtoolsReporter } from '@crucible/types';
import {
  ListAccountsInputSchema,
  GetBalanceInputSchema,
  SignTxInputSchema,
  SendTxLocalInputSchema,
  SwitchAccountInputSchema,
} from '@crucible/types/mcp/wallet';
import { createWalletServer } from './server.ts';
import { createWalletService } from './service.ts';

const PORT = process.env['WALLET_MCP_PORT']
  ? parseInt(process.env['WALLET_MCP_PORT'], 10)
  : mcp.DEFAULT_MCP_PORTS.wallet;

const CHAIN_RPC_URL = process.env['CHAIN_RPC_URL'] ?? 'http://localhost:3100/rpc';
const WORKSPACE_ROOT = process.env['WORKSPACE_ROOT'] ?? process.cwd();
const devtools = createDevtoolsReporter('wallet');

console.log(
  `[mcp-wallet] starting on port ${PORT} (workspaceRoot: ${WORKSPACE_ROOT}, chainRpcUrl: ${CHAIN_RPC_URL})`,
);

if (!existsSync(WORKSPACE_ROOT)) {
  throw new Error(`[mcp-wallet] WORKSPACE_ROOT does not exist: ${WORKSPACE_ROOT}`);
}

const service = createWalletService({ chainRpcUrl: CHAIN_RPC_URL, workspaceRoot: WORKSPACE_ROOT });

const ErrorSchema = z.object({ error: z.string() });

// Wire-format schemas (no branded/transformed outputs) for OpenAPI route typing.
const ListAccountsOutputWireSchema = z.object({
  accounts: z.array(
    z.object({
      label: z.string(),
      address: z.string(),
      balance: z.string(),
    }),
  ),
});

const GetBalanceOutputWireSchema = z.object({ balance: z.string() });
const SignTxOutputWireSchema = z.object({ signedTx: z.string() });
const SendTxLocalOutputWireSchema = z.object({
  txHash: z.string(),
  gasUsed: z.string(),
  status: z.enum(['success', 'reverted']),
});
const SwitchAccountOutputWireSchema = z.object({ active: z.string() });

const listAccountsRoute = createRoute({
  method: 'get',
  path: '/accounts',
  request: { query: ListAccountsInputSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: ListAccountsOutputWireSchema } },
      description: 'Wallet accounts',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const getBalanceRoute = createRoute({
  method: 'get',
  path: '/balance/{address}',
  request: { params: GetBalanceInputSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: GetBalanceOutputWireSchema } },
      description: 'Current balance',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const signTxRoute = createRoute({
  method: 'post',
  path: '/sign_tx',
  request: {
    body: { content: { 'application/json': { schema: SignTxInputSchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: SignTxOutputWireSchema } },
      description: 'Signed transaction',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const sendTxLocalRoute = createRoute({
  method: 'post',
  path: '/send_tx_local',
  request: {
    body: { content: { 'application/json': { schema: SendTxLocalInputSchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: SendTxLocalOutputWireSchema } },
      description: 'Local send result',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const switchAccountRoute = createRoute({
  method: 'post',
  path: '/switch_account',
  request: {
    body: { content: { 'application/json': { schema: SwitchAccountInputSchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: SwitchAccountOutputWireSchema } },
      description: 'Active account switched',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const mcpServer = createWalletServer({ chainRpcUrl: CHAIN_RPC_URL, workspaceRoot: WORKSPACE_ROOT });

type Env = { Variables: { parsedBody: unknown } };

type McpToolsCallBody = {
  method?: string;
  params?: {
    name?: string;
    arguments?: unknown;
  };
};

type McpResponseBody = {
  result?: {
    structuredContent?: unknown;
    content?: Array<{ text?: string }>;
  };
  error?: unknown;
};

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
  console.log(`[mcp-wallet] → ${c.req.method} ${path}`);
  await next();
  const ms = Date.now() - start;
  const status = c.res?.status ?? 0;
  const logFn = status >= 500 ? console.error : status >= 400 ? console.warn : console.log;
  logFn(`[mcp-wallet] ← ${status} (${ms}ms)`);
});

function walletToolForPath(path: string): string | null {
  if (path === '/accounts') return 'list_accounts';
  if (path.startsWith('/balance/')) return 'get_balance';
  if (path === '/sign_tx') return 'sign_tx';
  if (path === '/send_tx_local') return 'send_tx_local';
  if (path === '/switch_account') return 'switch_account';
  return null;
}

app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  let tool = walletToolForPath(path);
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

app.openapi(listAccountsRoute, async (c) => {
  try {
    const output = await service.listAccounts();
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-wallet] list_accounts error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(getBalanceRoute, async (c) => {
  try {
    const output = await service.getBalance(c.req.valid('param'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-wallet] get_balance error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(signTxRoute, async (c) => {
  try {
    const output = await service.signTx(c.req.valid('json'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-wallet] sign_tx error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(sendTxLocalRoute, async (c) => {
  try {
    const output = await service.sendTxLocal(c.req.valid('json'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-wallet] send_tx_local error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(switchAccountRoute, async (c) => {
  try {
    const output = await service.switchAccount(c.req.valid('json'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-wallet] switch_account error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.all('/mcp', (c) => transport.handleRequest(c.req.raw, { parsedBody: c.get('parsedBody') }));

app.doc('/doc', { openapi: '3.0.0', info: { version: '0.0.0', title: 'crucible-wallet' } });

export type AppType = typeof app;

export default {
  port: PORT,
  fetch: app.fetch,
};
