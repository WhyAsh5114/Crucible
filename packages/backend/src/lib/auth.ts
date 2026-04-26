import { prisma } from './prisma';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { anonymous } from 'better-auth/plugins';

// Sensible defaults so the backend boots in dev/hackathon mode without
// requiring every operator to populate a fresh .env. Override in production.
const port = process.env['PORT'] ?? '5000';
const betterAuthUrl = process.env['BETTER_AUTH_URL'] ?? `http://localhost:${port}`;
const googleClientId = process.env['GOOGLE_CLIENT_ID'];
const googleClientSecret = process.env['GOOGLE_CLIENT_SECRET'];

if (!process.env['BETTER_AUTH_URL']) {
  console.warn(
    `[auth] BETTER_AUTH_URL not set — defaulting to ${betterAuthUrl}. ` +
      `Set BETTER_AUTH_URL explicitly for hosted deployments.`,
  );
}

// Google social login is optional — both vars must be set to enable it.
const googleProviderConfig =
  googleClientId && googleClientSecret
    ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } }
    : {};

if (!googleClientId || !googleClientSecret) {
  console.warn('[auth] Google OAuth credentials absent — social login disabled.');
}

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
  plugins: [anonymous()],
  ...(Object.keys(googleProviderConfig).length > 0
    ? { socialProviders: googleProviderConfig }
    : {}),
});
