import { isProduction } from './env.js';

/**
 * Google sign-in (OpenID Connect, server-side authorization-code flow with PKCE).
 *
 * Required (API only; nothing here is ever sent to the browser):
 *   GOOGLE_CLIENT_ID       OAuth client ID (also the expected ID-token audience)
 *   GOOGLE_CLIENT_SECRET   OAuth client secret
 *   GOOGLE_REDIRECT_URI    exact callback URI registered at Google, e.g. http://localhost:5190/api/v1/auth/google/callback
 *   WEB_APP_URL            origin of the web app, e.g. http://localhost:5190
 *   OAUTH_STATE_SECRET     >= 32 random characters; encrypts the short-lived OAuth cookie
 *
 * When any of them is missing or invalid, Google sign-in is reported as unavailable (never half-enabled).
 * Values are read at call time and never logged.
 */
const GOOGLE = Object.freeze({
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
});

export const GOOGLE_CALLBACK_PATH = '/api/v1/auth/google/callback';

const read = (name) => (process.env[name] ?? '').trim();

function parseUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/** Why the configuration can't be used (for a one-time startup warning), or null when it is valid. */
export function googleConfigProblem() {
  const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'WEB_APP_URL', 'OAUTH_STATE_SECRET'].filter((n) => !read(n));
  if (missing.length) return `not configured (missing ${missing.join(', ')})`;
  const redirect = parseUrl(read('GOOGLE_REDIRECT_URI'));
  const web = parseUrl(read('WEB_APP_URL'));
  if (!redirect || redirect.pathname !== GOOGLE_CALLBACK_PATH || redirect.search || redirect.hash) {
    return `GOOGLE_REDIRECT_URI must be an absolute URL ending in ${GOOGLE_CALLBACK_PATH}`;
  }
  if (!web || web.pathname !== '/' || web.search || web.hash) return 'WEB_APP_URL must be an origin such as https://app.example.com';
  if (redirect.origin !== web.origin) return 'GOOGLE_REDIRECT_URI must be on the WEB_APP_URL origin (the callback is proxied to the API)';
  if (isProduction && (redirect.protocol !== 'https:' || web.protocol !== 'https:')) return 'GOOGLE_REDIRECT_URI and WEB_APP_URL must use https in production';
  if (read('OAUTH_STATE_SECRET').length < 32) return 'OAUTH_STATE_SECRET must be at least 32 characters';
  return null;
}

/**
 * Test-only endpoint overrides (a local fake Google in automated tests). Ignored in production, so a
 * misconfigured production server can never trust another issuer or key set.
 */
function endpoints() {
  if (isProduction) return GOOGLE;
  const issuer = read('GOOGLE_TEST_ISSUER');
  return Object.freeze({
    authorizationEndpoint: read('GOOGLE_TEST_AUTHORIZATION_ENDPOINT') || GOOGLE.authorizationEndpoint,
    tokenEndpoint: read('GOOGLE_TEST_TOKEN_ENDPOINT') || GOOGLE.tokenEndpoint,
    jwksUri: read('GOOGLE_TEST_JWKS_URI') || GOOGLE.jwksUri,
    issuers: issuer ? [issuer] : GOOGLE.issuers,
  });
}

/** The validated configuration, or null when Google sign-in is unavailable. */
export function getGoogleConfig() {
  if (googleConfigProblem()) return null;
  return Object.freeze({
    clientId: read('GOOGLE_CLIENT_ID'),
    clientSecret: read('GOOGLE_CLIENT_SECRET'),
    redirectUri: read('GOOGLE_REDIRECT_URI'),
    webAppUrl: new URL(read('WEB_APP_URL')).origin,
    stateSecret: read('OAUTH_STATE_SECRET'),
    ...endpoints(),
  });
}
