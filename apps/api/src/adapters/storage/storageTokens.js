import { createHmac } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

/**
 * Short-lived, signed capability tokens (HS256) for storage flows. The key is derived from
 * JWT_ACCESS_SECRET with a purpose label, so a storage token can never be used as an access token and
 * vice versa (different key, issuer and audience).
 *
 *   'upload-intent'  — what the API agreed to accept (who, where, category…), returned with a signed upload
 *                      URL and presented again at finalisation; it also names the random staging key.
 *   'local-upload'   — local driver only: lets the browser PUT one staging object.
 *   'local-download' — local driver only: lets the browser GET one object for `expiresIn` seconds.
 */
const ISSUER = 'fogaan-dawo/storage';

function keyFor(purpose) {
  const base = process.env.JWT_ACCESS_SECRET;
  if (!base || base.length < 32) throw new Error('JWT_ACCESS_SECRET is required for storage tokens');
  return createHmac('sha256', base).update(`fogaan-storage:${purpose}`).digest();
}

export async function signStorageToken(purpose, claims, expiresInSeconds) {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(purpose)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(keyFor(purpose));
}

/** Returns the claims, or null for an invalid, expired, tampered or wrong-purpose token. */
export async function verifyStorageToken(purpose, token) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, keyFor(purpose), { issuer: ISSUER, audience: purpose, algorithms: ['HS256'] });
    return payload;
  } catch {
    return null;
  }
}
