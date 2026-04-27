/**
 * Shared test utilities: sign in anonymously through the real better-auth
 * handler so the session token is in exactly the format the middleware expects.
 */

import { auth } from '../src/lib/auth';
import { prisma } from '../src/lib/prisma';

export interface TestSession {
  userId: string;
  /** Value to pass as the Cookie header: `better-auth.session_token=<signed-token>` */
  cookie: string;
}

/**
 * Sign in anonymously via the better-auth handler and return the userId and
 * ready-to-use cookie string.
 *
 * Better-auth uses signed cookies (token.HMAC_SIGNATURE). We MUST use the
 * Set-Cookie value from the response — not the raw token in the JSON body —
 * because auth.api.getSession verifies the HMAC before looking up the session.
 *
 * Call `deleteTestUser(session.userId)` in afterEach/afterAll to clean up;
 * cascades to sessions and workspaces.
 */
export async function createTestSession(): Promise<TestSession> {
  const response = await auth.handler(
    new Request(
      `${process.env['BETTER_AUTH_URL'] ?? 'http://localhost:5000'}/api/auth/sign-in/anonymous`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
    ),
  );

  // Read body first (consuming the stream), then inspect headers.
  const body = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(`Anonymous sign-in failed: ${response.status} — ${JSON.stringify(body)}`);
  }

  const user = body['user'] as { id: string } | undefined;
  if (!user?.id) {
    throw new Error(`No user in sign-in response: ${JSON.stringify(body)}`);
  }

  // Extract the SIGNED cookie value from Set-Cookie.
  // Bun 1.x supports getSetCookie(); fall back to parsing get('set-cookie').
  const setCookies: string[] =
    (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ??
    (response.headers.get('set-cookie') ?? '').split(/,\s*(?=[^;]+(?:;|$))/);

  let signedCookieValue: string | undefined;
  for (const raw of setCookies) {
    const match = raw.match(/^better-auth\.session_token=([^;]+)/);
    if (match?.[1]) {
      signedCookieValue = match[1].trim();
      break;
    }
  }

  if (!signedCookieValue) {
    throw new Error(
      `Session cookie not set in sign-in response. Set-Cookie: ${setCookies.join(' | ')}`,
    );
  }

  return {
    userId: user.id,
    cookie: `better-auth.session_token=${signedCookieValue}`,
  };
}

/**
 * Delete the test user and all their data (sessions, workspaces) via cascade.
 */
export async function deleteTestUser(userId: string): Promise<void> {
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
}
