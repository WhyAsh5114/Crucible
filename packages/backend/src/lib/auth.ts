import { betterAuth } from 'better-auth';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { prismaAdapter } from 'better-auth/adapters/prisma';

const databaseUrl = process.env['DATABASE_URL'];

if (!databaseUrl) {
  throw new Error('Missing DATABASE_URL environment variable');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
});
