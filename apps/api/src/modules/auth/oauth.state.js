import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';

/**
 * One Google sign-in attempt ("OAuth transaction"): state (CSRF), nonce (ID-token replay), the PKCE
 * verifier, the mode (login | link) and — for linking — the user and session that started it.
 *
 * It lives only in the `fd_oauth` cookie:
 * - encrypted and authenticated (JWE dir + A256GCM, key derived from OAUTH_STATE_SECRET), so it can be
 *   neither read nor forged — the PKCE verifier never reaches JavaScript or Google before the exchange;
 * - HttpOnly, Secure in production, path /api/v1/auth/google, 10-minute lifetime;
 * - SameSite=Lax: Google's redirect back is a cross-site top-level navigation, and a Strict cookie
 *   would not be sent with it. Lax still withholds it from cross-site subrequests and POSTs.
 * The callback clears it whatever the outcome, and each state is accepted at most once (replay guard).
 */
export const OAUTH_COOKIE = 'fd_oauth';
export const OAUTH_COOKIE_PATH = '/api/v1/auth/google';
export const OAUTH_TTL_SECONDS = 600;
const AUDIENCE = 'fogaan-dawo-oauth';

const random = (bytes) => randomBytes(bytes).toString('base64url');
const keyFor = (secret) => createHash('sha256').update(`fogaan-dawo/oauth-state/v1:${secret}`).digest();

/** RFC 7636 S256 challenge for a verifier. */
export const codeChallengeFor = (verifier) => createHash('sha256').update(verifier, 'ascii').digest('base64url');

/** A new Google sign-in transaction: random state, nonce and PKCE verifier/challenge. */
export function newOAuthTransaction({ mode, userId = null, sessionId = null, next = null, language = null }) {
  return {
    state: random(32),
    nonce: random(32),
    codeVerifier: random(48), // 64 characters (RFC 7636 allows 43–128)
    mode,
    userId,
    sessionId,
    next,
    language,
  };
}

/** Encrypts the OAuth transaction into a short-lived cookie value (state is checked on the callback). */
export async function sealOAuthTransaction(secret, tx, now = new Date()) {
  const iat = Math.floor(now.getTime() / 1000);
  return new EncryptJWT({ st: tx.state, nc: tx.nonce, cv: tx.codeVerifier, m: tx.mode, u: tx.userId, sid: tx.sessionId, nx: tx.next, lg: tx.language })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + OAUTH_TTL_SECONDS)
    .encrypt(keyFor(secret));
}

/** The transaction from the cookie, or null when it is missing, tampered with, foreign or expired. */
export async function openOAuthTransaction(secret, value, now = new Date()) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return null;
  try {
    const { payload: p } = await jwtDecrypt(value, keyFor(secret), { audience: AUDIENCE, currentDate: now, contentEncryptionAlgorithms: ['A256GCM'], keyManagementAlgorithms: ['dir'] });
    if (typeof p.st !== 'string' || typeof p.nc !== 'string' || typeof p.cv !== 'string' || !['login', 'link'].includes(p.m)) return null;
    return { state: p.st, nonce: p.nc, codeVerifier: p.cv, mode: p.m, userId: p.u ?? null, sessionId: p.sid ?? null, next: p.nx ?? null, language: p.lg ?? null, expiresAt: p.exp * 1000 };
  } catch {
    return null;
  }
}

/** Constant-time comparison of the returned and expected OAuth state. */
export function statesMatch(expected, received) {
  if (typeof received !== 'string' || received.length > 512) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/*
 * Replay guard: a state is accepted once. Google also accepts each authorization code once, and the
 * cookie is cleared after the callback; this closes the remaining window (a captured callback URL +
 * cookie replayed before expiry). Kept in memory, which covers a single API instance; several instances
 * behind a load balancer would need a shared store (see docs/auth.md).
 */
const usedStates = new Map(); // sha256(state) -> expiry (ms)
const MAX_TRACKED = 50_000;

/** Marks an OAuth state as used so a callback cannot be replayed. Returns false on reuse. */
export function consumeState(state, expiresAtMs, nowMs = Date.now()) {
  for (const [key, expiry] of usedStates) {
    if (expiry > nowMs && usedStates.size < MAX_TRACKED) break;
    usedStates.delete(key); // insertion order ≈ expiry order: drop expired (or the oldest when full)
  }
  const key = createHash('sha256').update(state).digest('hex');
  if (usedStates.has(key)) return false;
  usedStates.set(key, expiresAtMs);
  return true;
}

/** Sets the sealed OAuth transaction cookie (HTTP-only, path-scoped, short-lived). */
export function setOAuthCookie(res, value, { secure }) {
  res.cookie(OAUTH_COOKIE, value, { httpOnly: true, secure, sameSite: 'lax', path: OAUTH_COOKIE_PATH, maxAge: OAUTH_TTL_SECONDS * 1000 });
}

/** Clears the OAuth transaction cookie after the callback. */
export function clearOAuthCookie(res, { secure }) {
  res.clearCookie(OAUTH_COOKIE, { httpOnly: true, secure, sameSite: 'lax', path: OAUTH_COOKIE_PATH });
}
