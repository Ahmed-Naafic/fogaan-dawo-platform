/**
 * Google sign-in helpers for the web app. The browser never sees Google tokens or the client secret:
 * it asks the API for Google's URL, navigates there, and comes back with only an outcome code; the
 * session itself arrives in the HTTP-only refresh cookie.
 */

/** Outcome / error codes the API can send back (in `authError` / `googleError` or an API error). */
export const GOOGLE_ERROR_CODES = Object.freeze([
  'GOOGLE_UNAVAILABLE',
  'GOOGLE_CANCELLED',
  'GOOGLE_FAILED',
  'GOOGLE_STATE_INVALID',
  'GOOGLE_EMAIL_UNVERIFIED',
  'GOOGLE_EMAIL_EXISTS',
  'GOOGLE_ALREADY_LINKED',
  'GOOGLE_ALREADY_CONNECTED',
  'GOOGLE_NOT_CONNECTED',
  'GOOGLE_ADMIN_NOT_ALLOWED',
  'GOOGLE_LINK_SESSION_INVALID',
  'LAST_SIGN_IN_METHOD',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_DISABLED',
  'ACCOUNT_NOT_ACTIVE',
  'NO_USABLE_ROLE',
  'RATE_LIMITED',
  'NETWORK_ERROR',
]);

/** i18n key for a code; anything unknown (or tampered with in the URL) is a generic failure. */
export const googleErrorKey = (code) => `googleAuth.errors.${GOOGLE_ERROR_CODES.includes(code) ? code : 'GOOGLE_FAILED'}`;

/** Same rule as the API: an internal path only (the destination is re-checked against the user's roles). */
export function googleNextParam(next) {
  if (typeof next !== 'string' || next.length > 300 || next.includes('//')) return undefined;
  return /^\/[A-Za-z0-9\-_/?=&%.]*$/.test(next) ? next : undefined;
}
