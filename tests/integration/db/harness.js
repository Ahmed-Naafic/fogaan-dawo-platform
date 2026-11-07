// Test harness for database integration tests against the configured Neon branch.
// Isolation: every run creates its own Postgres schema (fd_test_<time>_<random>), applies the
// migrations into it, and drops only that schema afterwards. The `public` schema (real data) is
// never read or written.
// On a production database (DATABASE_ENV=production) tests run only when ALLOW_PRODUCTION_DB=true is
// set for that single command; otherwise they are skipped.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const require = createRequire(import.meta.url);

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace('-pooler.', '.');
  } catch {
    return null;
  }
};

/**
 * Hosts of the production database as declared in the repository's .env (DATABASE_ENV=production).
 * Test commands load .env and then .env.development (the Neon development branch); if the effective test
 * URL still resolves to a production host, the tests refuse to run.
 */
function productionHosts() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return [];
  const vars = Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/))
      .filter(Boolean)
      .map(([, k, v]) => [k, v.replace(/^['"]|['"]$/g, '')]),
  );
  if (vars.DATABASE_ENV !== 'production') return [];
  return [hostOf(vars.DATABASE_URL), hostOf(vars.DIRECT_URL)].filter(Boolean);
}

export function databaseTestsSkipReason() {
  const { DIRECT_URL, DATABASE_URL, DATABASE_ENV, ALLOW_PRODUCTION_DB } = process.env;
  if (!DIRECT_URL) return 'DIRECT_URL not set (no Neon database configured)';
  if (DATABASE_ENV === 'development') {
    const prod = productionHosts();
    const hits = [hostOf(DIRECT_URL), hostOf(DATABASE_URL)].filter((h) => h && prod.includes(h));
    if (hits.length) throw new Error('Refusing to run database tests: DATABASE_ENV is "development" but the URL points at the production host from .env');
    return null;
  }
  if (DATABASE_ENV === 'production') {
    return ALLOW_PRODUCTION_DB === 'true' ? null : 'DATABASE_ENV is "production"; set ALLOW_PRODUCTION_DB=true for this run to use isolated test schemas';
  }
  return 'DATABASE_ENV must be "development" or "production"';
}

export async function setupTestDatabase() {
  const schema = `fd_test_${Date.now()}_${randomBytes(3).toString('hex')}`;
  const url = new URL(process.env.DIRECT_URL);
  url.searchParams.set('schema', schema);
  url.searchParams.set('connection_limit', '5');
  const testUrl = url.toString();

  // Apply the real migrations into the isolated schema.
  const prismaCli = require.resolve('prisma/build/index.js', { paths: [ROOT] });
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', join(ROOT, 'prisma', 'schema.prisma')], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: testUrl, DIRECT_URL: testUrl },
    stdio: 'pipe',
  });

  // Services import the shared Prisma client; point it at the test schema before importing them.
  process.env.DATABASE_URL = testUrl;
  const { prisma } = await import('../../../apps/api/src/config/database.js');

  async function teardown() {
    await prisma.$disconnect();
    if (!/^fd_test_\d+_[0-9a-f]{6}$/.test(schema)) throw new Error(`refusing to drop unexpected schema ${schema}`);
    const { PrismaClient } = await import('@prisma/client');
    const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL });
    try {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await admin.$disconnect();
    }
  }

  return { prisma, schema, teardown };
}
