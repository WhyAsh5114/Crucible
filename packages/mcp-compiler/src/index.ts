/**
 * mcp-compiler entry point.
 *
 * Starts an OpenAPIHono HTTP server on DEFAULT_MCP_PORTS.compiler (3101) or
 * the port specified by the COMPILER_MCP_PORT environment variable.
 *
 * Exposes both:
 *   POST /mcp   — MCP protocol transport (hidden from OpenAPI docs)
 *   REST routes — typed endpoints consumable via hc<AppType> from the frontend
 *
 * Environment flags:
 *   COMPILER_MCP_PORT=N     — override the listen port
 *   WORKSPACE_ROOT=<path>   — workspace root for resolving source paths (defaults to cwd)
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { localhostHostValidation } from '@modelcontextprotocol/hono';
import { existsSync } from 'node:fs';
import { basename, join, relative, isAbsolute } from 'node:path';
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { mcp } from '@crucible/types';
import {
  CompileInputSchema,
  CompileOutputSchema,
  GetAbiInputSchema,
  GetAbiOutputSchema,
  GetBytecodeInputSchema,
  GetBytecodeOutputSchema,
  ListContractsOutputSchema,
} from '@crucible/types/mcp/compiler';
import { compileSolidity } from './compiler.ts';
import {
  storeContracts,
  resolveContract,
  listContractNames,
  persistArtifacts,
} from './artifact-store.ts';
import { createCompilerServer } from './server.ts';

const PORT = process.env['COMPILER_MCP_PORT']
  ? parseInt(process.env['COMPILER_MCP_PORT'], 10)
  : mcp.DEFAULT_MCP_PORTS.compiler;

const WORKSPACE_ROOT = process.env['WORKSPACE_ROOT'] ?? process.cwd();

console.log(`[mcp-compiler] starting on port ${PORT} (workspaceRoot: ${WORKSPACE_ROOT})`);

if (!existsSync(WORKSPACE_ROOT)) {
  throw new Error(`[mcp-compiler] WORKSPACE_ROOT does not exist: ${WORKSPACE_ROOT}`);
}

// ── Error schema ────────────────────────────────────────────────────────────

const ErrorSchema = z.object({ error: z.string() });

// ── OpenAPI routes ──────────────────────────────────────────────────────────

const compileRoute = createRoute({
  method: 'post',
  path: '/compile',
  request: {
    body: { content: { 'application/json': { schema: CompileInputSchema } }, required: true },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: CompileOutputSchema } },
      description: 'Compilation result',
    },
    400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Bad request' },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const getAbiRoute = createRoute({
  method: 'get',
  path: '/abi/{contractName}',
  request: { params: GetAbiInputSchema },
  responses: {
    200: { content: { 'application/json': { schema: GetAbiOutputSchema } }, description: 'ABI' },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not found' },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const getBytecodeRoute = createRoute({
  method: 'get',
  path: '/bytecode/{contractName}',
  request: { params: GetBytecodeInputSchema },
  responses: {
    200: {
      content: { 'application/json': { schema: GetBytecodeOutputSchema } },
      description: 'Bytecode',
    },
    404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Not found' },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

const listContractsRoute = createRoute({
  method: 'get',
  path: '/contracts',
  responses: {
    200: {
      content: { 'application/json': { schema: ListContractsOutputSchema } },
      description: 'Contract list',
    },
    500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Error' },
  },
});

// ── App ─────────────────────────────────────────────────────────────────────

const mcpServer = createCompilerServer({ workspaceRoot: WORKSPACE_ROOT });

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
app.openapi(compileRoute, async (c) => {
  try {
    const { sourcePath, settings } = c.req.valid('json');
    const absolutePath = join(WORKSPACE_ROOT, sourcePath);
    const rel = relative(WORKSPACE_ROOT, absolutePath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      return c.json({ error: 'sourcePath must resolve within the workspace root' }, 400);
    }
    const result = await compileSolidity(absolutePath, settings as Record<string, unknown>);
    storeContracts(result.contracts, basename(absolutePath));
    await persistArtifacts(WORKSPACE_ROOT, result.contracts);
    const seen = new Set<string>();
    const topWarnings = (result.warnings ?? []).filter((w) => {
      if (seen.has(w.message)) return false;
      seen.add(w.message);
      return true;
    });
    return c.json(
      { contracts: result.contracts, ...(topWarnings.length > 0 ? { warnings: topWarnings } : {}) },
      200,
    );
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(getAbiRoute, async (c) => {
  try {
    const { contractName } = c.req.valid('param');
    const artifact = resolveContract(contractName);
    if (!artifact)
      return c.json({ error: `Contract "${contractName}" not found. Run compile first.` }, 404);
    return c.json({ abi: artifact.abi }, 200);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(getBytecodeRoute, async (c) => {
  try {
    const { contractName } = c.req.valid('param');
    const artifact = resolveContract(contractName);
    if (!artifact)
      return c.json({ error: `Contract "${contractName}" not found. Run compile first.` }, 404);
    return c.json(
      { bytecode: artifact.bytecode, deployedBytecode: artifact.deployedBytecode },
      200,
    );
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(listContractsRoute, async (c) => {
  try {
    return c.json({ contracts: listContractNames() }, 200);
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// MCP protocol endpoint (hidden from OpenAPI spec).
app.all('/mcp', (c) => transport.handleRequest(c.req.raw, { parsedBody: c.get('parsedBody') }));

// OpenAPI spec.
app.doc('/doc', { openapi: '3.0.0', info: { version: '0.0.0', title: 'crucible-compiler' } });

// Export typed app for frontend use: import type { AppType } from '@crucible/mcp-compiler'
export type AppType = typeof app;

export default {
  port: PORT,
  fetch: app.fetch,
};
