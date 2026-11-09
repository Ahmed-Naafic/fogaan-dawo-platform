import { getAuthConfig } from '../../config/auth.js';
import { CLIENT_HEADER, ClientType } from './auth.constants.js';

/**
 * Refresh-token delivery strategy
 * - Web (default): the refresh token travels ONLY in an HttpOnly, SameSite=Strict cookie scoped to
 *   /api/v1/auth (Secure in production). JavaScript can never read it; it is never in a response body.
 * - Native apps (`X-Fogaan-Client: native`): no cookie jar, so the token is returned in the body and
 *   must be kept in the platform's secure storage (Keychain / Android Keystore).
 * Access tokens are always returned in the body and kept in memory by the client.
 */
export const clientTypeOf = (req) => (req.get(CLIENT_HEADER) === ClientType.native ? ClientType.native : ClientType.web);

/** Sets the HTTP-only refresh-token cookie (path /api/v1/auth, SameSite=Strict, Secure in production). */
export function setRefreshCookie(res, token, expiresAt) {
  const config = getAuthConfig();
  res.cookie(config.refreshCookieName, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: config.refreshCookiePath,
    expires: expiresAt,
  });
}

/** Clears the refresh-token cookie. */
export function clearRefreshCookie(res) {
  const config = getAuthConfig();
  res.clearCookie(config.refreshCookieName, { httpOnly: true, secure: config.cookieSecure, sameSite: 'strict', path: config.refreshCookiePath });
}

/** Web clients: cookie only. Native clients: body only. Never mix, so a cookie can't be replayed as a body token. */
export function readRefreshToken(req) {
  if (clientTypeOf(req) === ClientType.native) return req.body?.refreshToken ?? null;
  return req.cookies?.[getAuthConfig().refreshCookieName] ?? null;
}

/** Sends tokens to the client according to its type and returns the JSON-safe session payload. */
export function deliverRefreshToken(req, res, { refreshToken, expiresAt }) {
  if (clientTypeOf(req) === ClientType.native) return { refreshToken, refreshTokenExpiresAt: expiresAt };
  setRefreshCookie(res, refreshToken, expiresAt);
  return { refreshTokenExpiresAt: expiresAt };
}
