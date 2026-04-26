/**
 * mcp-compiler entry point.
 *
 * Starts a Hono HTTP server on DEFAULT_MCP_PORTS.compiler (3101) or the port
 * specified by the COMPILER_MCP_PORT environment variable.
 *
 * Environment flags:
 *   MOCK_COMPILER=true      — bypass real solc; return fixture data
 *   COMPILER_MCP_PORT=N     — override the listen port
 *   WORKSPACE_ROOT=<path>   — workspace root for resolving source paths (defaults to cwd)
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { localhostHostValidation } from '@modelcontextprotocol/hono';
import { Hono } from 'hono';
import { mcp } from '@crucible/types';
import { createCompilerServer } from './server.ts';

const PORT = process.env['COMPILER_MCP_PORT']
  ? parseInt(process.env['COMPILER_MCP_PORT'], 10)
  : mcp.DEFAULT_MCP_PORTS.compiler;

const IS_MOCK = process.env['MOCK_COMPILER'] === 'true';
const WORKSPACE_ROOT = process.env['WORKSPACE_ROOT'] ?? process.cwd();

console.log(
  `[mcp-compiler] starting on port ${PORT} (mode: ${
    IS_MOCK ? 'mock' : 'real'
  }, workspaceRoot: ${WORKSPACE_ROOT})`,
);

const mcpServer = createCompilerServer({ workspaceRoot: WORKSPACE_ROOT });

// Typed Hono context so c.get('parsedBody') is properly typed.
type Env = { Variables: { parsedBody: unknown } };

const transport = new WebStandardStreamableHTTPServerTransport();
await mcpServer.connect(transport);

const app = new Hono<Env>();

// DNS rebinding protection (same as createMcpHonoApp default).
app.use('*', localhostHostValidation());

// Parse JSON bodies once and stash them so the transport stream isn't consumed twice.
app.use('*', async (c, next) => {
  if (c.req.header('content-type')?.includes('application/json')) {
    try {
      c.set('parsedBody', await c.req.json<unknown>());
    } catch {
      // non-JSON or empty body — leave parsedBody unset
    }
  }
  await next();
});

app.all('/mcp', (c) => transport.handleRequest(c.req.raw, { parsedBody: c.get('parsedBody') }));

export default {
  port: PORT,
  fetch: app.fetch,
};
