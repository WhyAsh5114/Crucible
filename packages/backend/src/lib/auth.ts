import { betterAuth } from 'better-auth';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { prismaAdapter } from 'better-auth/adapters/prisma';

const databaseUrl = process.env['DATABASE_URL'];
const betterAuthUrl = process.env['BETTER_AUTH_URL'];
const googleClientId = process.env['GOOGLE_CLIENT_ID'];
const googleClientSecret = process.env['GOOGLE_CLIENT_SECRET'];

if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL environment variable');
}

if (!betterAuthUrl) {
  throw new Error('Missing BETTER_AUTH_URL environment variable');
}

if (!googleClientId) {
  throw new Error('Missing GOOGLE_CLIENT_ID environment variable');
}

if (!googleClientSecret) {
  throw new Error('Missing GOOGLE_CLIENT_SECRET environment variable');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

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
