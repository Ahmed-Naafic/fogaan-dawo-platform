import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Shared secret for scheduled-job endpoints (/api/internal/jobs/*). Vercel Cron sends it as
 * `Authorization: Bearer <CRON_SECRET>` when the project has a CRON_SECRET environment variable;
 * any other scheduler must send the same header. Read at call time and never logged.
 * Unset or shorter than 32 characters = the job endpoints are disabled (503), never open.
 */
const MIN_LENGTH = 32;

export function cronConfigProblem() {
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret) return 'CRON_SECRET is not set';
  if (secret.length < MIN_LENGTH) return `CRON_SECRET must be at least ${MIN_LENGTH} characters`;
  return null;
}

const digest = (value) => createHash('sha256').update(value).digest();

/** Constant-time check of an Authorization header against CRON_SECRET. */
export function isValidCronAuthorization(header) {
  if (cronConfigProblem()) return false;
  const [scheme, token] = String(header ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) return false;
  return timingSafeEqual(digest(token), digest(process.env.CRON_SECRET));
}
