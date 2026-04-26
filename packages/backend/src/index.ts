import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { auth } from './lib/auth';
import { runtimeApi } from './api/runtime';
import { workspaceApi } from './api/workspace';

const app = new OpenAPIHono();

app.use(
  '*',
  cors({
    maxAge: 600,
    credentials: true,
    origin: 'http://localhost:5173',
    exposeHeaders: ['Content-Length'],
    allowMethods: ['POST', 'GET', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

app.on(['POST', 'GET'], '/api/auth/*', (c) => {
  return auth.handler(c.req.raw);
});

app.route('/api', workspaceApi);
app.route('/api', runtimeApi);

app.doc('/doc', { openapi: '3.0.0', info: { version: '0.0.0', title: 'crucible-backend' } });

// Export typed app for frontend use: import type { AppType } from '@crucible/backend'
export type AppType = typeof app;

export default app;
