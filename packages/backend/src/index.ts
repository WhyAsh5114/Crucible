import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { prisma } from './lib/prisma';
import { upgradeWebSocket, websocket } from 'hono/bun';
import { auth, requireSession } from './lib/auth';
import { agentApi } from './api/agent';
import { runtimeApi } from './api/runtime';
import { rpcApi } from './api/rpc';
import { workspaceApi } from './api/workspace';
import { inferenceApi } from './api/inference';
import { terminalApi } from './api/terminal';
import { modelsApi } from './api/models';
import { shipApi } from './api/ship';

export { upgradeWebSocket };

const app = new OpenAPIHono();

// Primary origin for the frontend shell.
// Portless local dev: https://crucible.localhost
// Raw SvelteKit dev:  http://localhost:5173
const frontendOrigin = process.env['CRUCIBLE_FRONTEND_ORIGIN'] ?? 'http://localhost:5173';

// Optional regex string to allow preview subdomain origins.
// Example: ^https://preview\.[a-z0-9][a-z0-9-]{0,62}\.crucible\.localhost$
// This env var is operator-controlled and therefore trusted.
const rawPreviewPattern = process.env['CRUCIBLE_PREVIEW_ORIGIN_PATTERN'];
const previewOriginRe = rawPreviewPattern ? new RegExp(rawPreviewPattern) : null;

app.use(
  '*',
  cors({
    maxAge: 600,
    credentials: true,
    origin: (requestOrigin) => {
      if (requestOrigin === frontendOrigin) return requestOrigin;
      if (previewOriginRe?.test(requestOrigin)) return requestOrigin;
      return null;
    },
    exposeHeaders: ['Content-Length'],
    allowMethods: ['POST', 'GET', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

app.on(['POST', 'GET'], '/api/auth/*', (c) => {
  return auth.handler(c.req.raw);
});

// Routes that live outside sub-apps still need explicit auth guards.
app.use('/api/agent/*', requireSession);
app.use('/api/prompt', requireSession);
app.use('/api/models', requireSession);

const apiRoutes = app
  .route('/api', workspaceApi)
  .route('/api', runtimeApi)
  .route('/api', rpcApi)
  .route('/api', agentApi)
  .route('/api', inferenceApi)
  .route('/api', modelsApi)
  .route('/api', shipApi)
  .route('/', terminalApi);

apiRoutes.doc('/doc', { openapi: '3.0.0', info: { version: '0.0.0', title: 'crucible-backend' } });

// Export typed app for frontend Hono RPC use:
//   import type { AppType } from '@crucible/backend';
//   const client = hc<AppType>('/');
export type AppType = typeof apiRoutes;

// Bun's auto-serve uses a 10s idle timeout, which kills SSE streams before
// the next keepalive ping. Use explicit Bun.serve and disable idle timeout
// so long-lived `/api/agent/stream` connections stay open.
// On startup, clear any stale previewUrls left over from a previous process.
// They point to Vite servers that no longer exist after a restart.
prisma.workspaceRuntime.updateMany({ data: { previewUrl: null } }).catch(() => undefined);

const port = Number(process.env['PORT'] ?? 3000);
export default {
  port,
  idleTimeout: 0,
  fetch: apiRoutes.fetch,
  websocket,
};
