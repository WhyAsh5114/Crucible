import { randomBytes } from 'node:crypto';
import { prisma } from './prisma';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { siwe } from 'better-auth/plugins/siwe';
import { verifyMessage } from 'viem';
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe';

const port = process.env['PORT'] ?? '3000';
const betterAuthUrl = process.env['BETTER_AUTH_URL'] ?? `http://localhost:${port}`;
const googleClientId = process.env['GOOGLE_CLIENT_ID'];
const googleClientSecret = process.env['GOOGLE_CLIENT_SECRET'];

if (!process.env['BETTER_AUTH_URL']) {
  console.warn(
    `[auth] BETTER_AUTH_URL not set — defaulting to ${betterAuthUrl}. ` +
      `Set BETTER_AUTH_URL explicitly for hosted deployments.`,
  );
}

const googleProviderConfig =
  googleClientId && googleClientSecret
    ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } }
    : {};

if (!googleClientId || !googleClientSecret) {
  console.warn('[auth] Google OAuth credentials absent — social login disabled.');
}

// SIWE `domain` (RFC 3986 authority) MUST match the host in the message the
// frontend builds — the wallet shows it to the user, signs over it, and viem's
// `validateSiweMessage` rejects any mismatch. The frontend uses
// `window.location.host`, so we derive from the user-facing origin here.
//
// Resolution order: explicit `SIWE_DOMAIN` → frontend origin host.
const frontendOrigin = process.env['CRUCIBLE_FRONTEND_ORIGIN'] ?? 'http://localhost:5173';
const siweDomain = process.env['SIWE_DOMAIN'] ?? new URL(frontendOrigin).host;

export const auth = betterAuth({
  baseURL: betterAuthUrl,
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  trustedOrigins: [
    'http://localhost:5173',
    'https://crucible.localhost',
    ...(process.env['TRUSTED_ORIGINS']?.split(',') ?? []),
  ],
  plugins: [
    siwe({
      domain: siweDomain,
      // 16 bytes = 128 bits of entropy, hex-encoded → 32 chars. Plenty for a
      // single-use nonce that the plugin invalidates after one verify.
      getNonce: async () => randomBytes(16).toString('hex'),
      verifyMessage: async ({ message, signature, address }) => {
        try {
          const parsed = parseSiweMessage(message);
          // Cross-check the parsed message against our domain + the address
          // the client claims signed it. Nonce + expiration are enforced by
          // better-auth's internal nonce store.
          const validFields = validateSiweMessage({
            message: parsed,
            address: address as `0x${string}`,
            domain: siweDomain,
          });
          if (!validFields) return false;
          // EOA-only: viem's root `verifyMessage` does ecrecover. Smart
          // contract wallet (EIP-1271) verification needs a public client +
          // RPC — add later if/when we support SCWs.
          return await verifyMessage({
            address: address as `0x${string}`,
            message,
            signature: signature as `0x${string}`,
          });
        } catch {
          return false;
        }
      },
    }),
  ],
  ...(Object.keys(googleProviderConfig).length > 0
    ? { socialProviders: googleProviderConfig }
    : {}),
});
