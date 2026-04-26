import { prisma } from './prisma';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

const betterAuthUrl = process.env['BETTER_AUTH_URL'];
const googleClientId = process.env['GOOGLE_CLIENT_ID'];
const googleClientSecret = process.env['GOOGLE_CLIENT_SECRET'];

if (!betterAuthUrl) {
  throw new Error('Missing BETTER_AUTH_URL environment variable');
}

if (!googleClientId) {
  throw new Error('Missing GOOGLE_CLIENT_ID environment variable');
}

if (!googleClientSecret) {
  throw new Error('Missing GOOGLE_CLIENT_SECRET environment variable');
}

export const auth = betterAuth({
  baseURL: betterAuthUrl,
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  socialProviders: {
    google: {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    },
  },
});
