/**
 * mcp-deployer entry point.
 *
 * Starts an OpenAPIHono HTTP server on DEFAULT_MCP_PORTS.deployer (3102) or
 * the port specified by DEPLOYER_MCP_PORT.
 *
 * Exposes both:
 *   POST /mcp   — MCP protocol transport (hidden from OpenAPI docs)
 *   REST routes — typed endpoints consumable via hc<AppType> from the frontend
 *
 * Environment flags:
 *   DEPLOYER_MCP_PORT=N    — override the listen port
 *   CHAIN_RPC_URL=<url>    — chain RPC endpoint (defaults to http://localhost:3100/rpc)
 *   COMPILER_URL=<url>     — compiler service URL (defaults to http://localhost:3101)
 *   WORKSPACE_ROOT=<path>  — workspace root for path checks (defaults to cwd)
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { hostHeaderValidation } from '@modelcontextprotocol/hono';
import { existsSync } from 'node:fs';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  mcp,
  createDevtoolsReporter,
  type McpToolsCallBody,
  type McpResponseBody,
} from '@crucible/types';
import {
  DeployLocalInputSchema,
  SimulateLocalInputSchema,
  TraceInputSchema,
  CallInputSchema,
  DeployOgChainInputSchema,
  ListDeploymentsInputSchema,
} from '@crucible/types/mcp/deployer';
import { createDeployerServer } from './server.ts';
import { createDeployerService } from './service.ts';
import {
  SimulateBundleInputSchema,
  ExecuteTxInputSchema,
  SimulateBundleOutputSchema,
  ExecuteTxOutputSchema,
  ExecutionStatusOutputSchema,
  createKeeperHubClient,
  getKeeperHubConfig,
} from './keeperhub-client.ts';

const PORT = process.env['DEPLOYER_MCP_PORT']
  ? parseInt(process.env['DEPLOYER_MCP_PORT'], 10)
  : mcp.DEFAULT_MCP_PORTS.deployer;

const CHAIN_RPC_URL = process.env['CHAIN_RPC_URL'] ?? 'http://localhost:3100/rpc';
const COMPILER_URL = process.env['COMPILER_URL'] ?? 'http://localhost:3101';
const WORKSPACE_ROOT = process.env['WORKSPACE_ROOT'] ?? process.cwd();
const OG_DEPLOY_PRIVATE_KEY = process.env['OG_DEPLOY_PRIVATE_KEY'];
const KEEPERHUB_API_KEY = process.env['KEEPERHUB_API_KEY'];
const KEEPERHUB_API_URL = process.env['KEEPERHUB_API_URL'] ?? 'https://app.keeperhub.com/api';
const devtools = createDevtoolsReporter('deployer');

console.log(
  `[mcp-deployer] starting on port ${PORT} (workspaceRoot: ${WORKSPACE_ROOT}, chainRpcUrl: ${CHAIN_RPC_URL}, compilerUrl: ${COMPILER_URL}, ogDeploy: ${OG_DEPLOY_PRIVATE_KEY ? 'enabled' : 'disabled'}, keeperHub: ${KEEPERHUB_API_KEY ? 'enabled' : 'disabled'})`,
);

if (!existsSync(WORKSPACE_ROOT)) {
  throw new Error(`[mcp-deployer] WORKSPACE_ROOT does not exist: ${WORKSPACE_ROOT}`);
}

const service = createDeployerService({
  chainRpcUrl: CHAIN_RPC_URL,
  workspaceRoot: WORKSPACE_ROOT,
  compilerUrl: COMPILER_URL,
  ...(OG_DEPLOY_PRIVATE_KEY ? { ogDeployPrivateKey: OG_DEPLOY_PRIVATE_KEY } : {}),
});

const ErrorSchema = z.object({ error: z.string() });

// Wire-format schemas (no branded/transformed outputs) for OpenAPI route typing.
const DeployLocalOutputWireSchema = z.object({
  address: z.string(),
  txHash: z.string(),
  gasUsed: z.string(),
  contractName: z.string(),
  abi: z.array(z.unknown()),
  functions: z.array(z.string()),
});

const SimulateLocalOutputWireSchema = z.object({
  result: z.string(),
  gasEstimate: z.string(),
  revertReason: z.string().optional(),
  logs: z.array(
    z.object({
      address: z.string(),
      topics: z.array(z.string()),
      data: z.string(),
    }),
  ),
});

const TraceOutputWireSchema = z.object({
  txHash: z.string(),
  decodedCalls: z.array(
    z.object({
      depth: z.number().int().nonnegative(),
      to: z.string(),
      fn: z.string(),
      args: z.array(z.unknown()),
      result: z.unknown().nullable(),
      reverted: z.boolean(),
    }),
  ),
  storageReads: z.array(
    z.object({
      contract: z.string(),
      slot: z.string(),
      value: z.string(),
    }),
  ),
  storageWrites: z.array(
    z.object({
      contract: z.string(),
      slot: z.string(),
      value: z.string(),
    }),
  ),
  events: z.array(
    z.object({
      contract: z.string(),
      name: z.string(),
      args: z.record(z.string(), z.unknown()),
      signatureHash: z.string(),
    }),
  ),
  revertReason: z.string().optional(),
  gasUsed: z.string(),
});

const CallOutputWireSchema = z.object({ result: z.string() });

const DeployOgChainOutputWireSchema = z.object({
  address: z.string(),
  txHash: z.string(),
  gasUsed: z.string(),
  explorerUrl: z.string(),
});

// ── KeeperHub wire schemas ───────────────────────────────────────────────────

const SimulateBundleWireOutputSchema = SimulateBundleOutputSchema;
const ExecuteTxWireOutputSchema = ExecuteTxOutputSchema;
const ExecutionStatusWireOutputSchema = ExecutionStatusOutputSchema;

const ListDeploymentsOutputWireSchema = z.object({
  deployments: z.array(
    z.object({
      contractName: z.string(),
      address: z.string(),
      txHash: z.string(),
      network: z.enum(['local', '0g-galileo']),
      deployedAt: z.string(),
    }),
  ),
});

const deployLocalRoute = createRoute({
  method: 'post',
  path: '/deploy_local',
  request: {
    body: { content: { 'application/json': { schema: DeployLocalInputSchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: DeployLocalOutputWireSchema } },
      description: 'Deployed locally',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const simulateLocalRoute = createRoute({
  method: 'post',
  path: '/simulate_local',
  request: {
    body: {
      content: { 'application/json': { schema: SimulateLocalInputSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: SimulateLocalOutputWireSchema } },
      description: 'Simulation result',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const traceRoute = createRoute({
  method: 'post',
  path: '/trace',
  request: {
    body: { content: { 'application/json': { schema: TraceInputSchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: TraceOutputWireSchema } },
      description: 'Transaction trace',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const callRoute = createRoute({
  method: 'post',
  path: '/call',
  request: {
    body: { content: { 'application/json': { schema: CallInputSchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CallOutputWireSchema } },
      description: 'Read-only call result',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const deployOgChainRoute = createRoute({
  method: 'post',
  path: '/deploy_og_chain',
  request: {
    body: {
      content: { 'application/json': { schema: DeployOgChainInputSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: DeployOgChainOutputWireSchema } },
      description: 'Deployed to 0G Galileo testnet',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const simulateBundleRoute = createRoute({
  method: 'post',
  path: '/simulate_bundle',
  request: {
    body: {
      content: { 'application/json': { schema: SimulateBundleInputSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: SimulateBundleWireOutputSchema } },
      description: 'KeeperHub bundle simulation result',
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'KeeperHub not configured',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const executeTxRoute = createRoute({
  method: 'post',
  path: '/execute_tx',
  request: {
    body: { content: { 'application/json': { schema: ExecuteTxInputSchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ExecuteTxWireOutputSchema } },
      description: 'KeeperHub bundle execution initiated',
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'KeeperHub not configured',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const getExecutionStatusRoute = createRoute({
  method: 'get',
  path: '/execution_status/{executionId}',
  request: {
    params: z.object({ executionId: z.string().min(1) }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ExecutionStatusWireOutputSchema } },
      description: 'KeeperHub execution status',
    },
    503: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'KeeperHub not configured',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const listDeploymentsRoute = createRoute({
  method: 'post',
  path: '/list_deployments',
  request: {
    body: {
      content: { 'application/json': { schema: ListDeploymentsInputSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: ListDeploymentsOutputWireSchema } },
      description: 'Deployments in this session',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const mcpServer = createDeployerServer({
  service,
  ...(KEEPERHUB_API_KEY
    ? { keeperHubApiKey: KEEPERHUB_API_KEY, keeperHubBaseUrl: KEEPERHUB_API_URL }
    : {}),
});

// KeeperHub REST client (shared with REST routes below)
const khConfig = KEEPERHUB_API_KEY
  ? { apiKey: KEEPERHUB_API_KEY, baseUrl: KEEPERHUB_API_URL }
  : getKeeperHubConfig();
const khRestClient = khConfig ? createKeeperHubClient(khConfig) : null;

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
  console.log(`[mcp-deployer] → ${c.req.method} ${path}`);
  await next();
  const ms = Date.now() - start;
  const status = c.res?.status ?? 0;
  const logFn = status >= 500 ? console.error : status >= 400 ? console.warn : console.log;
  logFn(`[mcp-deployer] ← ${status} (${ms}ms)`);
});

function deployerToolForPath(path: string): string | null {
  if (path === '/deploy_local') return 'deploy_local';
  if (path === '/simulate_local') return 'simulate_local';
  if (path === '/trace') return 'trace';
  if (path === '/call') return 'call';
  if (path === '/deploy_og_chain') return 'deploy_og_chain';
  if (path === '/simulate_bundle') return 'simulate_bundle';
  if (path === '/execute_tx') return 'execute_tx';
  if (path.startsWith('/execution_status/')) return 'get_execution_status';
  if (path === '/list_deployments') return 'list_deployments';
  return null;
}

app.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  let tool = deployerToolForPath(path);
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

app.openapi(deployLocalRoute, async (c) => {
  try {
    const output = await service.deployLocal(c.req.valid('json'));
    // viem's Abi type is `readonly` but the wire schema is mutable JSONValue[].
    // Spread to satisfy the OpenAPI handler's structural type.
    return c.json({ ...output, abi: [...output.abi] }, 200);
  } catch (err) {
    console.error(`[mcp-deployer] deploy_local error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(simulateLocalRoute, async (c) => {
  try {
    const output = await service.simulateLocal(c.req.valid('json'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-deployer] simulate_local error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(traceRoute, async (c) => {
  try {
    const output = await service.trace(c.req.valid('json'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-deployer] trace error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(callRoute, async (c) => {
  try {
    const output = await service.call(c.req.valid('json'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-deployer] call error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(deployOgChainRoute, async (c) => {
  try {
    const output = await service.deploy0gChain(c.req.valid('json'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-deployer] deploy_og_chain error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(simulateBundleRoute, async (c) => {
  if (!khRestClient) {
    return c.json({ error: 'KEEPERHUB_API_KEY not configured' }, 503);
  }
  try {
    const output = await khRestClient.simulateBundle(c.req.valid('json'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-deployer] simulate_bundle error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(executeTxRoute, async (c) => {
  if (!khRestClient) {
    return c.json({ error: 'KEEPERHUB_API_KEY not configured' }, 503);
  }
  try {
    const output = await khRestClient.executeTx(c.req.valid('json'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-deployer] execute_tx error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(getExecutionStatusRoute, async (c) => {
  if (!khRestClient) {
    return c.json({ error: 'KEEPERHUB_API_KEY not configured' }, 503);
  }
  try {
    const { executionId } = c.req.valid('param');
    const output = await khRestClient.getExecutionStatus({ executionId });
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-deployer] get_execution_status error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(listDeploymentsRoute, async (c) => {
  try {
    const output = await service.listDeployments(c.req.valid('json'));
    return c.json(output, 200);
  } catch (err) {
    console.error(`[mcp-deployer] list_deployments error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

// Convenience GET endpoint used by other MCP services (e.g. mcp-wallet) to
// resolve a contract address by name without going through the MCP transport.
app.get('/deployments/:contractName', (c) => {
  const contractName = c.req.param('contractName');
  const network = c.req.query('network');
  const validNetwork = network === 'local' || network === '0g-galileo' ? network : undefined;
  const record = service.getDeployment(contractName, validNetwork);
  if (!record) {
    return c.json({ error: `No deployment found for "${contractName}"` }, 404);
  }
  return c.json(record, 200);
});

app.all('/mcp', (c) => transport.handleRequest(c.req.raw, { parsedBody: c.get('parsedBody') }));

app.doc('/doc', { openapi: '3.0.0', info: { version: '0.0.0', title: 'crucible-deployer' } });

export type AppType = typeof app;

export default {
  port: PORT,
  fetch: app.fetch,
};
