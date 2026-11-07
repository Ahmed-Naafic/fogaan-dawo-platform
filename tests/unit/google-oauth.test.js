// Unit tests: OAuth transaction cookie, PKCE, replay guard and Google configuration validation (no network, no DB).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeChallengeFor, consumeState, newOAuthTransaction, openOAuthTransaction, sealOAuthTransaction, statesMatch } from '../../apps/api/src/modules/auth/oauth.state.js';
import { getGoogleConfig, googleConfigProblem } from '../../apps/api/src/config/google.js';

const SECRET = 'x'.repeat(40);

test('PKCE S256 challenge matches the RFC 7636 test vector', () => {
  assert.equal(codeChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  const tx = newOAuthTransaction({ mode: 'login' });
  assert.ok(tx.codeVerifier.length >= 43 && tx.codeVerifier.length <= 128 && /^[A-Za-z0-9_-]+$/.test(tx.codeVerifier));
  assert.notEqual(tx.state, newOAuthTransaction({ mode: 'login' }).state, 'random per attempt');
});

test('the OAuth cookie round-trips, and is rejected when tampered with, sealed with another secret, or expired', async () => {
  const now = new Date('2026-11-06T10:00:00Z');
  const tx = newOAuthTransaction({ mode: 'link', userId: 'u1', sessionId: 's1', next: '/patient', language: 'so' });
  const sealed = await sealOAuthTransaction(SECRET, tx, now);
  assert.ok(!sealed.includes(tx.state) && !sealed.includes(tx.codeVerifier), 'encrypted');
  const opened = await openOAuthTransaction(SECRET, sealed, now);
  assert.equal(opened.state, tx.state);
  assert.equal(opened.codeVerifier, tx.codeVerifier);
  assert.equal(opened.mode, 'link');
  assert.equal(opened.userId, 'u1');
  assert.equal(opened.language, 'so');

  const parts = sealed.split('.');
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
  assert.equal(await openOAuthTransaction(SECRET, parts.join('.'), now), null, 'tampered');
  assert.equal(await openOAuthTransaction('y'.repeat(40), sealed, now), null, 'other secret');
  assert.equal(await openOAuthTransaction(SECRET, sealed, new Date(now.getTime() + 11 * 60_000)), null, 'expired after 10 minutes');
  assert.equal(await openOAuthTransaction(SECRET, undefined, now), null);
});

test('state comparison and one-time consumption', () => {
  assert.equal(statesMatch('abc', 'abc'), true);
  assert.equal(statesMatch('abc', 'abd'), false);
  assert.equal(statesMatch('abc', undefined), false);
  const now = Date.now();
  const state = newOAuthTransaction({ mode: 'login' }).state;
  assert.equal(consumeState(state, now + 60_000, now), true);
  assert.equal(consumeState(state, now + 60_000, now), false, 'second use refused');
});

test('Google configuration: unavailable unless complete and consistent; never half-enabled', () => {
  const keys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'WEB_APP_URL', 'OAUTH_STATE_SECRET'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const set = (values) => {
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, values);
  };
  const good = {
    GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_REDIRECT_URI: 'http://localhost:5190/api/v1/auth/google/callback',
    WEB_APP_URL: 'http://localhost:5190',
    OAUTH_STATE_SECRET: SECRET,
  };
  try {
    set({});
    assert.equal(getGoogleConfig(), null);
    assert.match(googleConfigProblem(), /missing GOOGLE_CLIENT_ID/);
    set(good);
    assert.equal(googleConfigProblem(), null);
    assert.equal(getGoogleConfig().webAppUrl, 'http://localhost:5190');
    set({ ...good, GOOGLE_REDIRECT_URI: 'http://localhost:5190/callback' });
    assert.match(googleConfigProblem(), /must be an absolute URL ending in/);
    set({ ...good, GOOGLE_REDIRECT_URI: 'http://localhost:5000/api/v1/auth/google/callback' });
    assert.match(googleConfigProblem(), /WEB_APP_URL origin/);
    set({ ...good, OAUTH_STATE_SECRET: 'short' });
    assert.match(googleConfigProblem(), /at least 32/);
    set({ ...good, WEB_APP_URL: 'http://localhost:5190/app' });
    assert.match(googleConfigProblem(), /must be an origin/);
    assert.ok(!String(googleConfigProblem()).includes('secret'), 'problems name variables, never values');
  } finally {
    set(Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== undefined)));
  }
});
