/**
 * mcp-chain entry point.
 *
 * Starts a Hono HTTP server on DEFAULT_MCP_PORTS.chain (3100) or the port
 * specified by the CHAIN_MCP_PORT environment variable.
 *
 * Environment flags:
 *   CHAIN_MOCK=true     — bypass real Hardhat; return fixture data
 *   CHAIN_MCP_PORT=N    — override the listen port
 */

import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { localhostHostValidation } from '@modelcontextprotocol/hono';
import { Hono } from 'hono';
import { mcp } from '@crucible/types';
import { createChainServer } from './server.ts';

const PORT = process.env['CHAIN_MCP_PORT']
  ? parseInt(process.env['CHAIN_MCP_PORT'], 10)
  : mcp.DEFAULT_MCP_PORTS.chain;

const IS_MOCK = process.env['CHAIN_MOCK'] === 'true';

console.log(`[mcp-chain] starting on port ${PORT} (mode: ${IS_MOCK ? 'mock' : 'real'})`);

const mcpServer = createChainServer();

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
