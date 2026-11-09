import { isProduction } from './env.js';

/**
 * Web Push (VAPID). API-only settings:
 *   VAPID_PUBLIC_KEY   served to browsers to subscribe (public by design)
 *   VAPID_PRIVATE_KEY  signs push requests — never leaves the server
 *   VAPID_SUBJECT      mailto:… or https://… contact for push services
 * Generate a pair with: npx web-push generate-vapid-keys
 * Missing/invalid → push is unavailable; in-app notifications keep working.
 */
const read = (name) => (process.env[name] ?? '').trim();
const B64URL = /^[A-Za-z0-9_-]+$/;

/** Push services browsers actually use. Subscriptions to any other host are refused (no SSRF). */
const PUSH_HOST_SUFFIXES = Object.freeze(['fcm.googleapis.com', 'push.services.mozilla.com', 'notify.windows.com', 'push.apple.com']);

/** Startup check for the Web Push VAPID keys: a problem description or null. */
export function pushConfigProblem() {
  const missing = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'].filter((n) => !read(n));
  if (missing.length) return `not configured (missing ${missing.join(', ')})`;
  if (!B64URL.test(read('VAPID_PUBLIC_KEY')) || read('VAPID_PUBLIC_KEY').length !== 87) return 'VAPID_PUBLIC_KEY must be the 87-character URL-safe base64 key from web-push';
  if (!B64URL.test(read('VAPID_PRIVATE_KEY')) || read('VAPID_PRIVATE_KEY').length !== 43) return 'VAPID_PRIVATE_KEY must be the 43-character URL-safe base64 key from web-push';
  if (!/^(mailto:.+@.+|https:\/\/.+)$/.test(read('VAPID_SUBJECT'))) return 'VAPID_SUBJECT must be a mailto: or https: URL';
  return null;
}

/** Test-only extra endpoint origins (a local fake push service). Ignored in production. */
const testOrigins = () => (isProduction ? [] : read('PUSH_TEST_ALLOWED_ORIGINS').split(',').map((o) => o.trim()).filter(Boolean));

/** VAPID settings { publicKey, privateKey, subject } or null when push is not configured. */
export function getPushConfig() {
  if (pushConfigProblem()) return null;
  return Object.freeze({ publicKey: read('VAPID_PUBLIC_KEY'), privateKey: read('VAPID_PRIVATE_KEY'), subject: read('VAPID_SUBJECT'), testOrigins: testOrigins() });
}

/** Only HTTPS endpoints of known push services (plus test origins outside production). */
export function isAllowedPushEndpoint(endpoint, config = getPushConfig()) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (config?.testOrigins.includes(url.origin)) return true;
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}
