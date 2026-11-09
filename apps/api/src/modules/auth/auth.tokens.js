import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';
import { getAuthConfig } from '../../config/auth.js';
import { ApiError } from '../../utils/ApiError.js';
import { AuthErrorCode } from './auth.constants.js';

/**
 * Access tokens: short-lived HS256 JWTs { sub: userId, sid: sessionId, role: activeRole }.
 * They are never trusted on their own — authenticate() re-checks the session, account status and
 * role assignment in the database on every request.
 */
export async function signAccessToken({ userId, sessionId, role }, { expiresInSeconds } = {}) {
  const config = getAuthConfig();
  const ttl = expiresInSeconds ?? config.accessTokenTtlSeconds;
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ sid: sessionId, role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(config.accessTokenSecret);
  return { token, expiresIn: ttl };
}

/** Verifies a JWT access token (signature, expiry, issuer, audience) and returns its claims. Throws TOKEN_EXPIRED / TOKEN_INVALID. */
export async function verifyAccessToken(token) {
  const config = getAuthConfig();
  try {
    const { payload } = await jwtVerify(token, config.accessTokenSecret, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || typeof payload.role !== 'string') {
      throw ApiError.unauthorized('Invalid access token', AuthErrorCode.tokenInvalid);
    }
    return { userId: payload.sub, sessionId: payload.sid, role: payload.role };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof joseErrors.JWTExpired) throw ApiError.unauthorized('Access token has expired', AuthErrorCode.tokenExpired);
    throw ApiError.unauthorized('Invalid access token', AuthErrorCode.tokenInvalid);
  }
}

/**
 * Refresh tokens: opaque `v1.<sessionId>.<activeRole>.<256-bit random>`. Only the SHA-256 hash of the
 * whole string is stored (sessions.refresh_token_hash), so the session id and role inside it cannot be
 * altered without failing the hash comparison. The session id lets a replayed, already-rotated token
 * be traced to its session so that session can be revoked (reuse detection).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A new random refresh token "<sessionId>.<secret>" (only its hash is stored). */
export function generateRefreshToken(sessionId, role) {
  return `v1.${sessionId}.${role}.${randomBytes(32).toString('base64url')}`;
}

/** Splits a refresh token into { sessionId, secret }, or null when malformed. */
export function parseRefreshToken(token) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 4 || parts[0] !== 'v1' || !UUID.test(parts[1]) || !/^(PATIENT|DOCTOR|ADMIN)$/.test(parts[2]) || parts[3].length < 40) {
    return null;
  }
  return { sessionId: parts[1], role: parts[2] };
}

/** SHA-256 hash of a token (what the database stores). */
export const hashToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex');

/** Constant-time comparison of a token with its stored hash. */
export function tokenMatchesHash(token, storedHash) {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(String(storedHash), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
