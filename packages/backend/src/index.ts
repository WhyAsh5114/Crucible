import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { auth } from './lib/auth';

const app = new Hono();

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

export default app;
