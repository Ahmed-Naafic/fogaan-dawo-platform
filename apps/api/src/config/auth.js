import { env } from './env.js';

/**
 * Authentication settings. Read from the environment at call time and validated; no secret has a
 * default. Values are never logged.
 */
const intFrom = (name, fallback, { min, max }) => {
  const raw = process.env[name];
  const value = raw == null || raw === '' ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return value;
};

/** bcrypt cost factor (no secrets involved; also used by the seed script). */
export const getBcryptRounds = () => intFrom('BCRYPT_ROUNDS', 12, { min: 10, max: 15 });

/** Rate-limit settings only (no secrets), so the app can be built without auth secrets (e.g. health checks in CI). */
export function getAuthRateLimitConfig() {
  return Object.freeze({
    windowMs: intFrom('AUTH_RATE_LIMIT_WINDOW_MINUTES', 15, { min: 1, max: 1440 }) * 60_000,
    limit: intFrom('AUTH_RATE_LIMIT_MAX', 20, { min: 1, max: 10_000 }),
  });
}

/** Validated auth settings (JWT secret, token lifetimes, cookie flags, bcrypt rounds). Throws when a required secret is missing. */
export function getAuthConfig() {
  const secret = process.env.JWT_ACCESS_SECRET ?? '';
  if (secret.length < 32) throw new Error('JWT_ACCESS_SECRET must be set to a random value of at least 32 characters');

  return Object.freeze({
    accessTokenSecret: new TextEncoder().encode(secret),
    issuer: process.env.JWT_ISSUER || 'fogaan-dawo-api',
    audience: process.env.JWT_AUDIENCE || 'fogaan-dawo-app',
    accessTokenTtlSeconds: intFrom('ACCESS_TOKEN_TTL_SECONDS', 900, { min: 60, max: 3600 }),
    refreshTokenTtlDays: intFrom('REFRESH_TOKEN_TTL_DAYS', 30, { min: 1, max: 90 }),
    bcryptRounds: getBcryptRounds(),
    refreshCookieName: 'fd_refresh',
    refreshCookiePath: '/api/v1/auth',
    cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : env.nodeEnv === 'production',
  });
}
