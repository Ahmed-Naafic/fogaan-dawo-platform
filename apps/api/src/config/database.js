import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

/**
 * Single Prisma client for the API process.
 * DATABASE_URL is the Neon *pooled* connection (runtime); migrations use DIRECT_URL (see prisma/schema.prisma).
 * Credentials come only from environment variables and are never logged.
 */
const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__fogaanPrisma ??
  new PrismaClient({
    // Errors are NOT logged by Prisma: its messages include Postgres "Failing row contains (...)"
    // details (emails, phones, password hashes). They are thrown to callers and logged sanitised by errorHandler.
    log: ['warn'],
  });

if (env.nodeEnv !== 'production') globalForPrisma.__fogaanPrisma = prisma;

/**
 * The Postgres schema Prisma model queries target (`?schema=` in DATABASE_URL, default "public").
 * Raw SQL does not follow that setting — it resolves names through search_path — so raw queries
 * must qualify table names with this schema (see utils/sql.js) to hit the same tables as Prisma.
 */
function resolveSchema(url) {
  let schema = 'public';
  try {
    schema = new URL(url).searchParams.get('schema') || 'public';
  } catch {
    /* no or invalid URL: Prisma will fail on its own with a clear error */
  }
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error('DATABASE_URL schema parameter must be a simple lower-case identifier');
  return schema;
}

export const databaseSchema = resolveSchema(process.env.DATABASE_URL);

export async function disconnectDatabase() {
  await prisma.$disconnect();
}
