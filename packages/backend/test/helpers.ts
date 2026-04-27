/**
 * Shared test utilities: create sessions directly in the DB so tests do not
 * depend on any HTTP auth endpoint (anonymous sign-in was removed in favour
 * of SIWE).
 *
 * Session cookie format matches what better-auth / Hono's `setSignedCookie`
 * produces: `{token}.{base64url(HMAC-SHA256(token, secret))}`.
 */

import { randomBytes } from 'node:crypto';
import { prisma } from '../src/lib/prisma';

export interface TestSession {
  userId: string;
  /** Value to pass as the Cookie header: `better-auth.session_token=<signed-token>` */
  cookie: string;
}

/**
 * Sign a value using the same HMAC-SHA256 + base64url algorithm that
 * Hono's `setSignedCookie` uses, so `auth.api.getSession()` accepts the cookie.
 */
async function signCookieValue(value: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(value));
  // better-call's getSignedCookie requires standard base64 WITH padding
  // (exactly 44 chars, ending in "="). Do NOT use base64url here.
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${value}.${b64}`;
}

/**
 * Create a unique test user + session directly in the DB and return a
 * signed session cookie that `auth.api.getSession()` will accept.
 *
 * Call `deleteTestUser(session.userId)` in afterEach/afterAll to clean up;
 * cascades to sessions and workspaces.
 */
export async function createTestSession(): Promise<TestSession> {
  const userId = `test-${randomBytes(8).toString('hex')}`;
  const email = `${userId}@crucible.test`;

  await prisma.user.create({
    data: { id: userId, name: 'Test User', email, emailVerified: false },
  });

  const token = randomBytes(32).toString('hex');
  await prisma.session.create({
    data: {
      id: randomBytes(16).toString('hex'),
      token,
      userId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  const secret =
    process.env['BETTER_AUTH_SECRET'] ??
    'crucible-test-secret-not-for-productionet-not-for-production';
  const signedValue = await signCookieValue(token, secret);

  return {
    userId,
    cookie: `better-auth.session_token=${signedValue}`,
  };
}

/**
 * Delete the test user and all their data (sessions, workspaces) via cascade.
 */
export async function deleteTestUser(userId: string): Promise<void> {
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
}
