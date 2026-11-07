import { getAuthConfig } from '../../config/auth.js';
import { setRefreshCookie } from './auth.cookies.js';
import * as googleService from './google.service.js';
import { clearOAuthCookie, OAUTH_COOKIE, setOAuthCookie } from './oauth.state.js';

/** Google sign-in endpoints. No token ever appears in a URL: the session travels in the refresh cookie. */

const cookieSecurity = () => ({ secure: getAuthConfig().cookieSecure });
const requestMeta = (req) => ({ userAgent: req.get('user-agent'), ipAddress: req.ip });

/** GET /providers — which external sign-in methods are available (public, no secrets). */
export function providers(_req, res) {
  res.status(200).json({ data: { google: { enabled: googleService.isGoogleAvailable() } } });
}

/** POST /google/start — returns the Google authorization URL and sets the one-time OAuth cookie. */
export async function start(req, res) {
  const { authorizationUrl, cookie } = await googleService.startSignIn({ next: req.body.next, language: req.body.language });
  setOAuthCookie(res, cookie, cookieSecurity());
  res.status(200).json({ data: { authorizationUrl } });
}

/** POST /google/link — same, for connecting Google to the signed-in account. */
export async function startLink(req, res) {
  const { authorizationUrl, cookie } = await googleService.startLink(req.auth, { language: req.body.language });
  setOAuthCookie(res, cookie, cookieSecurity());
  res.status(200).json({ data: { authorizationUrl } });
}

/** GET /google/callback — Google's redirect. Always ends in a redirect to the web app. */
export async function callback(req, res) {
  const security = cookieSecurity();
  const query = Object.fromEntries(['state', 'code', 'error', 'iss'].map((k) => [k, typeof req.query[k] === 'string' ? req.query[k] : undefined]).filter(([, v]) => v !== undefined));
  const result = await googleService.handleCallback({
    query,
    cookie: req.cookies?.[OAUTH_COOKIE],
    meta: requestMeta(req),
    onFailure: (reason) => console.warn(`[api] google sign-in rejected: ${reason}`),
  });
  clearOAuthCookie(res, security); // one-time: cleared whatever the outcome
  if (result.session) setRefreshCookie(res, result.session.refreshToken, result.session.expiresAt);
  res.set('Referrer-Policy', 'no-referrer'); // the callback URL carries the authorization code
  res.redirect(303, result.redirect);
}

/** GET /methods — the signed-in user's sign-in methods. */
export async function methods(req, res) {
  res.status(200).json({ data: await googleService.getSignInMethods(req.auth) });
}

/** DELETE /google — disconnects Google when another sign-in method remains. */
export async function disconnect(req, res) {
  res.status(200).json({ data: await googleService.disconnectGoogle(req.auth) });
}
