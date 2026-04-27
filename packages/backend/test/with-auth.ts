/**
 * Test helper: wrap a sub-app router with a fake auth middleware that injects
 * `userId = TEST_USER_ID` on the context, mirroring what `requireSession` does
 * in production. Lets route tests exercise ownership-gated handlers without
 * standing up a real better-auth session.
 *
 * The wrapper is intentionally typed loosely — it only needs `.fetch()` and
 * `.request()` at runtime, and the env-variable signatures of OpenAPIHono
 * sub-apps don't unify with a plain `Hono` instance otherwise.
 */

import { Hono } from 'hono';
import { TEST_USER_ID } from './setup';

export function withAuth(subApp: { fetch: (req: Request) => Response | Promise<Response> }): {
  request: Hono['request'];
  fetch: (req: Request) => Response | Promise<Response>;
} {
  const app = new Hono<{ Variables: { userId: string } }>();
  app.use('*', async (c, next) => {
    c.set('userId', TEST_USER_ID);
    await next();
  });
  // Forward every request to the sub-app via fetch — works regardless of
  // whether the sub-app is Hono or OpenAPIHono and avoids the env-variable
  // type mismatch that `app.route()` produces between the two.
  app.all('*', (c) => subApp.fetch(c.req.raw));
  return app;
}
