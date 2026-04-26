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
import { hostHeaderValidation } from '@modelcontextprotocol/hono';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
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
import { compileSolidity, type SolcSettings } from './compiler.ts';
import { createArtifactStore } from './artifact-store.ts';
import { createCompilerServer, assertContainedInWorkspace } from './server.ts';

const PORT = process.env['COMPILER_MCP_PORT']
  ? parseInt(process.env['COMPILER_MCP_PORT'], 10)
  : mcp.DEFAULT_MCP_PORTS.compiler;

const WORKSPACE_ROOT = process.env['WORKSPACE_ROOT'] ?? process.cwd();
const SOLC_VERSION = process.env['SOLC_VERSION'];

console.log(`[mcp-compiler] starting on port ${PORT} (workspaceRoot: ${WORKSPACE_ROOT})`);

if (!existsSync(WORKSPACE_ROOT)) {
  throw new Error(`[mcp-compiler] WORKSPACE_ROOT does not exist: ${WORKSPACE_ROOT}`);
}

const store = createArtifactStore();

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

const mcpServer = createCompilerServer({
  workspaceRoot: WORKSPACE_ROOT,
  solcVersion: SOLC_VERSION,
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
  console.log(`[mcp-compiler] \u2192 ${c.req.method} ${path}`);
  await next();
  const ms = Date.now() - start;
  const status = c.res?.status ?? 0;
  const logFn = status >= 500 ? console.error : status >= 400 ? console.warn : console.log;
  logFn(`[mcp-compiler] \u2190 ${status} (${ms}ms)`);
});

// REST route handlers
app.openapi(compileRoute, async (c) => {
  let tempDir: string | undefined;
  try {
    const { sourcePath, source, fileName, settings } = c.req.valid('json');
    let absolutePath: string;
    let rel: string;

    if (source !== undefined) {
      const solFileName = fileName ?? 'Inline.sol';
      console.log(
        `[mcp-compiler] compile inline=${solFileName} (${source.split('\n').length} lines)`,
      );
      tempDir = join(WORKSPACE_ROOT, '.crucible', 'tmp', `inline-${randomUUID()}`);
      await mkdir(tempDir, { recursive: true });
      absolutePath = join(tempDir, solFileName);
      await writeFile(absolutePath, source, 'utf8');
      rel = `<inline>/${solFileName}`;
    } else {
      console.log(`[mcp-compiler] compile path=${sourcePath}`);
      absolutePath = join(WORKSPACE_ROOT, sourcePath!);
      try {
        rel = await assertContainedInWorkspace(WORKSPACE_ROOT, absolutePath);
      } catch (e) {
        console.error(`[mcp-compiler] compile error: ${String(e)}`);
        return c.json({ error: String(e) }, 400);
      }
    }
    const result = await compileSolidity(absolutePath, {
      version: SOLC_VERSION,
      ...(settings ?? {}),
    } as SolcSettings);
    store.storeContracts(result.contracts, rel);
    if (!tempDir) {
      await store.persistArtifacts(WORKSPACE_ROOT, result.contracts);
    }
    const seen = new Set<string>();
    const topWarnings = (result.warnings ?? []).filter((w) => {
      if (seen.has(w.message)) return false;
      seen.add(w.message);
      return true;
    });
    const contractNames = result.contracts.map((c) => c.name);
    console.log(
      `[mcp-compiler] compile ok  contracts=[${contractNames.join(', ')}] warnings=${topWarnings.length}`,
    );
    for (const w of topWarnings) {
      console.warn(`[mcp-compiler] compile warn: ${w.message}`);
    }
    return c.json(
      { contracts: result.contracts, ...(topWarnings.length > 0 ? { warnings: topWarnings } : {}) },
      200,
    );
  } catch (err) {
    console.error(`[mcp-compiler] compile error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
});

app.openapi(getAbiRoute, async (c) => {
  try {
    const { contractName } = c.req.valid('param');
    const artifact = store.resolveContract(contractName);
    if (!artifact) {
      console.warn(`[mcp-compiler] get_abi not found: ${contractName}`);
      return c.json({ error: `Contract "${contractName}" not found. Run compile first.` }, 404);
    }
    console.log(
      `[mcp-compiler] get_abi ok  contract=${contractName} fns=${(artifact.abi as unknown[]).length}`,
    );
    return c.json({ abi: artifact.abi }, 200);
  } catch (err) {
    console.error(`[mcp-compiler] get_abi error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(getBytecodeRoute, async (c) => {
  try {
    const { contractName } = c.req.valid('param');
    const artifact = store.resolveContract(contractName);
    if (!artifact) {
      console.warn(`[mcp-compiler] get_bytecode not found: ${contractName}`);
      return c.json({ error: `Contract "${contractName}" not found. Run compile first.` }, 404);
    }
    const creationBytes = Math.ceil((artifact.bytecode.length - 2) / 2);
    console.log(
      `[mcp-compiler] get_bytecode ok  contract=${contractName} creationBytes=${creationBytes}`,
    );
    return c.json(
      { bytecode: artifact.bytecode, deployedBytecode: artifact.deployedBytecode },
      200,
    );
  } catch (err) {
    console.error(`[mcp-compiler] get_bytecode error: ${String(err)}`);
    return c.json({ error: String(err) }, 500);
  }
});

app.openapi(listContractsRoute, async (c) => {
  try {
    const contracts = store.listContractNames();
    console.log(`[mcp-compiler] list_contracts ok  count=${contracts.length}`);
    return c.json({ contracts }, 200);
  } catch (err) {
    console.error(`[mcp-compiler] list_contracts error: ${String(err)}`);
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
