import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { auth } from './lib/auth';
import { agentApi } from './api/agent';
import { runtimeApi } from './api/runtime';
import { workspaceApi } from './api/workspace';

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
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

app.on(['POST', 'GET'], '/api/auth/*', (c) => {
  return auth.handler(c.req.raw);
});

/** Require a valid better-auth session; return 401 otherwise. */
const requireSession = createMiddleware(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ code: 'unauthorized', message: 'Authentication required' }, 401);
  }
  await next();
});

app.use('/api/workspace/*', requireSession);
app.use('/api/runtime', requireSession);
app.use('/api/agent/*', requireSession);

const apiRoutes = app.route('/api', workspaceApi).route('/api', runtimeApi).route('/api', agentApi);

apiRoutes.doc('/doc', { openapi: '3.0.0', info: { version: '0.0.0', title: 'crucible-backend' } });

// Export typed app for frontend Hono RPC use:
//   import type { AppType } from '@crucible/backend';
//   const client = hc<AppType>('/');
export type AppType = typeof apiRoutes;

export default apiRoutes;
