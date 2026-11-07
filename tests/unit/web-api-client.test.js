// Unit tests for the web API client (apps/web/src/lib/apiClient.js) with a scripted fetch.
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../../apps/web/src/lib/apiClient.js';

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, statusText: String(status), text: async () => (body === undefined ? '' : JSON.stringify(body)) });
const authResult = (n) => ({ data: { accessToken: `access-${n}`, user: { id: 'u1' }, roles: ['PATIENT'], activeRole: 'PATIENT', profiles: {}, session: { id: 's1' } } });

let calls;
let realFetch;
let realLocks;

beforeEach(() => {
  client.__resetApiClientForTests();
  calls = [];
  realFetch = globalThis.fetch;
  realLocks = Object.getOwnPropertyDescriptor(globalThis.navigator ?? {}, 'locks');
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (globalThis.navigator && realLocks) Object.defineProperty(globalThis.navigator, 'locks', realLocks);
});

/** routes: (url, init) => response | Promise<response> */
function mockFetch(handler) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, auth: init.headers.Authorization ?? null });
    return handler(url, init);
  };
}

test('every request sends credentials, the web client header and JSON', async () => {
  mockFetch(() => json(200, { data: { ok: true } }));
  client.setAccessToken('access-0');
  assert.deepEqual(await client.apiRequest('/v1/auth/me'), { ok: true });
  const [{ url, init }] = calls;
  assert.equal(url, '/api/v1/auth/me');
  assert.equal(init.credentials, 'include');
  assert.equal(init.headers['X-Fogaan-Client'], 'web');
  assert.equal(init.headers.Authorization, 'Bearer access-0');
});

test('API errors surface the stable backend code and details', async () => {
  mockFetch(() => json(409, { error: { code: 'EMAIL_TAKEN', message: 'taken', details: { field: 'email' } } }));
  await assert.rejects(client.apiRequest('/v1/auth/register', { method: 'POST', body: {}, auth: false }), (e) => e instanceof client.ApiRequestError && e.status === 409 && e.code === 'EMAIL_TAKEN' && e.details.field === 'email');
  mockFetch(() => Promise.reject(new TypeError('offline')));
  await assert.rejects(client.apiRequest('/v1/x', { auth: false }), (e) => e.code === 'NETWORK_ERROR' && e.status === 0);
});

test('concurrent requests with an expired token share ONE refresh and are all retried', async () => {
  let refreshes = 0;
  mockFetch(async (url, init) => {
    if (url.endsWith('/v1/auth/refresh')) {
      refreshes += 1;
      await new Promise((r) => setTimeout(r, 20));
      return json(200, authResult(refreshes));
    }
    if (init.headers.Authorization === 'Bearer stale') return json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } });
    return json(200, { data: { token: init.headers.Authorization } });
  });
  client.setAccessToken('stale');
  const results = await Promise.all(Array.from({ length: 6 }, () => client.apiRequest('/v1/auth/me')));
  assert.equal(refreshes, 1, 'exactly one refresh request');
  assert.ok(results.every((r) => r.token === 'Bearer access-1'), 'all retried with the new token');
  const refreshCall = calls.find((c) => c.url.endsWith('/refresh'));
  assert.equal(refreshCall.init.credentials, 'include');
  assert.equal(refreshCall.init.headers.Authorization, undefined, 'refresh relies on the HTTP-only cookie');
});

test('a late 401 after another caller already refreshed does not refresh again', async () => {
  let refreshes = 0;
  mockFetch(async (url, init) => {
    if (url.endsWith('/refresh')) {
      refreshes += 1;
      return json(200, authResult(refreshes));
    }
    if (init.headers.Authorization === 'Bearer stale') {
      await new Promise((r) => setTimeout(r, url.includes('slow') ? 40 : 0));
      return json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } });
    }
    return json(200, { data: { ok: init.headers.Authorization } });
  });
  client.setAccessToken('stale');
  const [fast, slow] = await Promise.all([client.apiRequest('/v1/fast'), client.apiRequest('/v1/slow')]);
  assert.equal(refreshes, 1);
  assert.equal(fast.ok, 'Bearer access-1');
  assert.equal(slow.ok, 'Bearer access-1');
});

test('a failed refresh ends the session once and rejects every waiting request', async () => {
  mockFetch((url) =>
    url.endsWith('/refresh') ? json(401, { error: { code: 'REFRESH_TOKEN_REUSED', message: 'reused' } }) : json(401, { error: { code: 'TOKEN_EXPIRED', message: 'expired' } }),
  );
  const ended = [];
  client.onSessionEnded((e) => ended.push(e.code));
  client.setAccessToken('stale');
  const outcomes = await Promise.allSettled([client.apiRequest('/v1/a'), client.apiRequest('/v1/b'), client.apiRequest('/v1/c')]);
  assert.ok(outcomes.every((o) => o.status === 'rejected' && o.reason.code === 'REFRESH_TOKEN_REUSED'));
  assert.equal(calls.filter((c) => c.url.endsWith('/refresh')).length, 1);
  assert.ok(ended.length >= 1 && ended.every((c) => c === 'REFRESH_TOKEN_REUSED'));
  assert.equal(client.hasAccessToken(), false, 'token cleared from memory');
});

test('a revoked session (403/401 session codes) ends the session without retrying', async () => {
  mockFetch(() => json(403, { error: { code: 'ACCOUNT_SUSPENDED', message: 'suspended' } }));
  const ended = [];
  client.onSessionEnded((e) => ended.push(e.code));
  client.setAccessToken('valid');
  await assert.rejects(client.apiRequest('/v1/auth/me'), (e) => e.code === 'ACCOUNT_SUSPENDED');
  assert.deepEqual(ended, ['ACCOUNT_SUSPENDED']);
  assert.equal(calls.length, 1, 'no refresh attempted for a suspended account');
});

test('without a token in memory an authenticated call restores from the cookie first', async () => {
  mockFetch((url, init) => (url.endsWith('/refresh') ? json(200, authResult(7)) : json(200, { data: { auth: init.headers.Authorization } })));
  assert.equal((await client.apiRequest('/v1/auth/me')).auth, 'Bearer access-7');
  assert.deepEqual(calls.map((c) => c.url), ['/api/v1/auth/refresh', '/api/v1/auth/me']);
});

test('refreshes are serialised across tabs through navigator.locks when available', async () => {
  const requested = [];
  if (globalThis.navigator) {
    Object.defineProperty(globalThis.navigator, 'locks', {
      configurable: true,
      value: { request: (name, fn) => (requested.push(name), fn()) },
    });
  }
  mockFetch(() => json(200, authResult(1)));
  await client.refreshSession();
  if (globalThis.navigator) assert.deepEqual(requested, ['fogaan-auth-refresh']);
});
