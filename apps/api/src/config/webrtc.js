/**
 * ICE server configuration for consultation calls (STUN only in this phase).
 *
 * WEBRTC_STUN_URLS: comma-separated `stun:` / `stuns:` URLs. Unset → Google's public STUN server;
 * set to an empty value → no STUN (host candidates only — same-network calls only).
 *
 * Future TURN support plugs in here: add a provider that returns
 * { urls: ['turn:…', 'turns:…:443?transport=tcp'], username, credential } with SHORT-LIVED credentials
 * derived from a server-only shared secret (coturn "use-auth-secret"). The secret must never be
 * returned to clients; only the derived, expiring username/credential pair is.
 */
const DEFAULT_STUN = 'stun:stun.l.google.com:19302';
const STUN_URL = /^stuns?:[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:\d{1,5})?$/i;

/** Parses WEBRTC_STUN_URLS. Returns { urls, invalid } (invalid entries are reported, never used). */
export function parseStunUrls(raw = process.env.WEBRTC_STUN_URLS) {
  const value = raw === undefined ? DEFAULT_STUN : raw;
  const entries = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const urls = [];
  const invalid = [];
  for (const entry of entries) {
    const port = Number(entry.split(':')[2] ?? 3478);
    if (STUN_URL.test(entry) && port > 0 && port < 65536) urls.push(entry);
    else invalid.push(entry);
  }
  return { urls: [...new Set(urls)], invalid };
}

/** Providers of ICE servers. TURN can be added later as another entry without touching callers. */
const providers = [
  () => {
    const { urls } = parseStunUrls();
    return urls.length ? [{ urls }] : [];
  },
];

/** The RTCConfiguration.iceServers handed to an authorised participant (public data only). */
export function iceServersFor(/* { userId, consultationId } — for future per-user TURN credentials */) {
  return providers.flatMap((p) => p());
}

/** Startup summary: a problem description or null. Names variables only. */
export function webrtcConfigProblem() {
  const { urls, invalid } = parseStunUrls();
  if (invalid.length) return `ignoring ${invalid.length} invalid WEBRTC_STUN_URLS entr${invalid.length === 1 ? 'y' : 'ies'}`;
  if (!urls.length) return 'no STUN server configured (WEBRTC_STUN_URLS is empty): calls work on the same network only';
  return null;
}
