import { getAuthConfig } from '../../config/auth.js';
import { prisma } from '../../config/database.js';

/** Business logic lives in services. Health reports process status only. */
export function getHealth() {
  return {
    status: 'ok',
    service: 'fogaan-dawo-api',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}

const DB_TIMEOUT_MS = 5000;

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms).unref())]);

/**
 * Readiness: required configuration is valid and the database answers. Reports only check names and
 * true/false — never connection strings, hosts or error messages.
 */
export async function getReadiness() {
  let config = true;
  try {
    getAuthConfig();
  } catch {
    config = false;
  }

  let database = true;
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, DB_TIMEOUT_MS);
  } catch (error) {
    database = false;
    console.error(`[api] readiness: database check failed: ${error.code ?? error.name}`);
  }

  const ready = config && database;
  return { status: ready ? 'ready' : 'not_ready', checks: { config, database }, timestamp: new Date().toISOString() };
}
