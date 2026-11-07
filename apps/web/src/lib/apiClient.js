/**
 * Centralised API client for the Fogaan Dawo backend.
 *
 * - Base URL: VITE_API_URL (default "/api", which the Vite dev server proxies to the API).
 * - Every request: `credentials: 'include'` (sends the HTTP-only refresh cookie on /auth routes)
 *   and `X-Fogaan-Client: web` (required by the API's CSRF protection; selects cookie delivery).
 * - The access token lives ONLY in this module's memory — never in localStorage/sessionStorage.
 * - A request that fails with an expired/invalid access token triggers ONE refresh shared by every
 *   concurrent caller (single flight), serialised across browser tabs with the Web Locks API, and is
 *   retried once. If the refresh fails the session is ended and listeners are notified.
 */
const API_BASE = String(import.meta.env?.VITE_API_URL || '/api').replace(/\/+$/, '');
const CLIENT_HEADER = { 'X-Fogaan-Client': 'web' };
const RETRY_AFTER_REFRESH = new Set(['TOKEN_EXPIRED', 'TOKEN_INVALID']);
const SESSION_ENDING = new Set(['SESSION_REVOKED', 'SESSION_EXPIRED', 'REFRESH_TOKEN_INVALID', 'REFRESH_TOKEN_REUSED', 'ACCOUNT_SUSPENDED', 'ACCOUNT_DISABLED', 'ACCOUNT_NOT_ACTIVE', 'NO_USABLE_ROLE']);

/** Error thrown for every failed API call; `code` is the backend's stable error code. */
export class ApiRequestError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let accessToken = null;
let refreshInFlight = null;
const sessionEndedListeners = new Set();

export const setAccessToken = (token) => {
  accessToken = token || null;
};
export const hasAccessToken = () => accessToken !== null;

/** Absolute URL for an API path such as "/v1/doctors/<id>/photo" (public images in <img src>). */
export const apiUrl = (path) => `${API_BASE}${path}`;

/** Subscribe to "the session can no longer be used" (refresh failed, revoked, suspended...). */
export function onSessionEnded(listener) {
  sessionEndedListeners.add(listener);
  return () => sessionEndedListeners.delete(listener);
}

function endSession(reason) {
  accessToken = null;
  for (const listener of sessionEndedListeners) listener(reason);
}

/**
 * `body`: JSON-encoded. `rawBody`: sent as-is (file uploads; the server detects the real type).
 * `responseType: 'blob'`: returns a Blob (private document downloads) instead of the JSON `data`.
 */
async function send(path, { method = 'GET', body, rawBody, headers: extraHeaders, responseType, token } = {}) {
  const headers = { Accept: responseType === 'blob' ? '*/*' : 'application/json', ...CLIENT_HEADER, ...extraHeaders };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'include',
    });
  } catch {
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'Network error');
  }

  if (response.ok && responseType === 'blob') return response.blob();
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const error = json?.error ?? {};
    throw new ApiRequestError(response.status, error.code ?? `HTTP_${response.status}`, error.message ?? response.statusText, error.details);
  }
  return json?.data ?? null;
}

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers share one request;
 * other tabs wait for this tab's refresh (and then use the rotated cookie) via navigator.locks.
 */
export function refreshSession() {
  if (!refreshInFlight) {
    const run = () => send('/v1/auth/refresh', { method: 'POST', body: {} });
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    refreshInFlight = (locks?.request ? locks.request('fogaan-auth-refresh', run) : run())
      .then((result) => {
        accessToken = result.accessToken;
        return result;
      })
      .catch((error) => {
        accessToken = null;
        throw error;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function refreshOrEnd() {
  try {
    await refreshSession();
  } catch (error) {
    endSession(error);
    throw error;
  }
}

/**
 * Calls the API. `auth: false` for public endpoints (login, register).
 * Authenticated calls refresh-and-retry once on TOKEN_EXPIRED / TOKEN_INVALID.
 */
export async function apiRequest(path, { method = 'GET', body, rawBody, headers, responseType, auth = true } = {}) {
  const options = { method, body, rawBody, headers, responseType };
  if (!auth) return send(path, options);
  if (!accessToken) await refreshOrEnd();

  const usedToken = accessToken;
  try {
    return await send(path, { ...options, token: usedToken });
  } catch (error) {
    if (error.status === 401 && RETRY_AFTER_REFRESH.has(error.code)) {
      // Another caller may already have refreshed while this request was in flight.
      if (accessToken === usedToken) await refreshOrEnd();
      try {
        return await send(path, { ...options, token: accessToken });
      } catch (retryError) {
        if (SESSION_ENDING.has(retryError.code) || retryError.status === 401) endSession(retryError);
        throw retryError;
      }
    }
    if (SESSION_ENDING.has(error.code)) endSession(error);
    throw error;
  }
}

/** For tests only: reset module state between cases. */
/**
 * Opens a long-lived authenticated response (Server-Sent Events) with the in-memory access token.
 * Refreshes once on an expired token. The caller reads response.body and aborts via `signal`.
 */
export async function openAuthenticatedStream(path, { signal } = {}) {
  if (!accessToken) await refreshOrEnd();
  const open = () =>
    fetch(`${API_BASE}${path}`, { headers: { Accept: 'text/event-stream', ...CLIENT_HEADER, Authorization: `Bearer ${accessToken}` }, credentials: 'include', signal });
  let response = await open();
  if (response.status === 401) {
    await refreshOrEnd();
    response = await open();
  }
  if (!response.ok || !response.body) throw new ApiRequestError(response.status, `HTTP_${response.status}`, 'Stream unavailable');
  return response;
}

/**
 * WebSocket URL for an API path (e.g. consultation signaling). Same origin as the API base:
 * a relative base ("/api") uses this page's host; an absolute base switches http(s) → ws(s).
 * Nothing secret goes into the URL — the signaling ticket is sent as the first message.
 */
export function apiSocketUrl(path) {
  const relative = path.replace(/^\/api/, '');
  if (/^https?:\/\//i.test(API_BASE)) return `${API_BASE.replace(/^http/i, 'ws')}${relative}`;
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss:' : 'ws:'}//${host}${API_BASE}${relative}`;
}

export function __resetApiClientForTests() {
  accessToken = null;
  refreshInFlight = null;
  sessionEndedListeners.clear();
}
