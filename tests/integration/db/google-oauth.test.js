// Google sign-in (OpenID Connect) — the real HTTP API against an isolated per-run schema, with a local
// fake Google (tests/support/fakeGoogle.js). No real Google endpoint is ever called.
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';
import { startFakeGoogle } from '../../support/fakeGoogle.js';

const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';
const GOOGLE_ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'WEB_APP_URL', 'OAUTH_STATE_SECRET', 'GOOGLE_TEST_AUTHORIZATION_ENDPOINT', 'GOOGLE_TEST_TOKEN_ENDPOINT', 'GOOGLE_TEST_JWKS_URI', 'GOOGLE_TEST_ISSUER'];

describe('Google sign-in (Neon, isolated schema, fake Google)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let server;
  let base;
  let google;
  let hashPassword;
  let seq = 0;
  const savedEnv = {};

  before(async () => {
    for (const k of GOOGLE_ENV) savedEnv[k] = process.env[k];
    // Start unconfigured — never the developer's .env values. Blank rather than delete: the Prisma client
    // loads the project .env when it starts and would put deleted variables back (it never overwrites).
    for (const k of GOOGLE_ENV) process.env[k] = '';
    process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
    process.env.BCRYPT_ROUNDS = '10';
    process.env.COOKIE_SECURE = 'false';
    db = await setupTestDatabase();
    prisma = db.prisma;
    ctx = await baseData(prisma);
    ({ hashPassword } = await import('../../../apps/api/src/utils/password.js'));
    const { createApp } = await import('../../../apps/api/src/app.js');
    server = createApp({ corsOrigins: [], authRateLimit: { limit: 10_000 } }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
    google = await startFakeGoogle();
  });

  after(async () => {
    for (const k of GOOGLE_ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await google?.close();
    await new Promise((r) => (server ? server.close(r) : r()));
    await db?.teardown();
  });

  const configure = () => {
    Object.assign(process.env, google.env, {
      GOOGLE_REDIRECT_URI: `${base}/api/v1/auth/google/callback`,
      WEB_APP_URL: base,
      OAUTH_STATE_SECRET: randomBytes(32).toString('base64url'),
    });
  };

  /* ------------------------------------------------------------ helpers */
  async function api(method, path, { body, token, cookie, client = 'web' } = {}) {
    const res = await fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(cookie ? { cookie } : {}),
        ...(client ? { 'x-fogaan-client': client } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const setCookies = res.headers.getSetCookie();
    const find = (name) => setCookies.find((c) => c.startsWith(`${name}=`));
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, body: json, location: res.headers.get('location'), refreshCookie: find('fd_refresh'), oauthCookie: find('fd_oauth'), headers: res.headers };
  }
  const pair = (setCookie) => setCookie?.split(';')[0];
  const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;

  /** start → fake consent → returns the callback path (with code/state) and the OAuth cookie. */
  async function authorize({ mode = 'login', token, next, plan } = {}) {
    const started = mode === 'link' ? await api('POST', '/api/v1/auth/google/link', { token, body: {} }) : await api('POST', '/api/v1/auth/google/start', { body: next ? { next } : {} });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    google.next(plan);
    const consent = await fetch(started.body.data.authorizationUrl, { redirect: 'manual' });
    assert.equal(consent.status, 302);
    const callback = new URL(consent.headers.get('location'));
    return { callbackPath: callback.pathname + callback.search, oauthCookie: pair(started.oauthCookie), start: started };
  }
  const callback = (path, cookie) => api('GET', path, { cookie, client: null });
  async function googleSignIn(plan, opts = {}) {
    const a = await authorize({ ...opts, plan });
    return { ...a, ...(await callback(a.callbackPath, a.oauthCookie)) };
  }
  const errorOf = (res) => new URL(res.location).searchParams.get('authError') ?? new URL(res.location).searchParams.get('googleError');

  async function passwordUser({ roles = ['PATIENT'], status = 'ACTIVE', email = `pw-${uniq()}@fogaandawo.test` } = {}) {
    const user = await prisma.user.create({
      data: {
        email,
        fullName: 'Password User',
        status,
        passwordHash: await hashPassword(PASSWORD),
        roles: { create: roles.map((r) => ({ roleId: ctx.roles[r].id })) },
        ...(roles.includes('PATIENT') ? { patientProfile: { create: {} } } : {}),
      },
    });
    const login = await api('POST', '/api/v1/auth/login', { client: 'native', body: { email, password: PASSWORD } });
    return { user, email, token: login.body?.data?.accessToken, sessionId: login.body?.data?.session?.id };
  }

  /* ------------------------------------------------------------- tests */

  test('missing configuration: reported unavailable, start refused, callback redirects with GOOGLE_UNAVAILABLE', async () => {
    const providers = await api('GET', '/api/v1/auth/providers');
    assert.deepEqual(providers.body.data, { google: { enabled: false } });
    const start = await api('POST', '/api/v1/auth/google/start', { body: {} });
    assert.equal(start.status, 503);
    assert.equal(start.body.error.code, 'GOOGLE_UNAVAILABLE');
    assert.equal(start.oauthCookie, undefined);
    const cb = await callback('/api/v1/auth/google/callback?code=x&state=y');
    assert.equal(cb.status, 303);
    assert.equal(cb.location, '/login?authError=GOOGLE_UNAVAILABLE');

    configure();
    assert.deepEqual((await api('GET', '/api/v1/auth/providers')).body.data, { google: { enabled: true } });
  });

  test('start: PKCE S256 + state + nonce in the URL, no secret; OAuth cookie is encrypted, HttpOnly, SameSite=Lax, short-lived', async () => {
    const start = await api('POST', '/api/v1/auth/google/start', { body: { next: '/patient/doctors', language: 'so' } });
    assert.equal(start.status, 200);
    const url = new URL(start.body.data.authorizationUrl);
    const p = url.searchParams;
    assert.equal(url.origin, google.issuer);
    assert.equal(p.get('client_id'), google.clientId);
    assert.equal(p.get('redirect_uri'), `${base}/api/v1/auth/google/callback`);
    assert.equal(p.get('response_type'), 'code');
    assert.equal(p.get('scope'), 'openid email profile');
    assert.equal(p.get('code_challenge_method'), 'S256');
    assert.equal(p.get('hl'), 'so');
    assert.ok(p.get('state').length >= 43 && p.get('nonce').length >= 43 && p.get('code_challenge').length === 43);
    assert.ok(!start.body.data.authorizationUrl.includes(google.clientSecret), 'client secret never leaves the server');

    const c = start.oauthCookie;
    assert.match(c, /HttpOnly/i);
    assert.match(c, /SameSite=Lax/i);
    assert.match(c, /Path=\/api\/v1\/auth\/google/);
    assert.match(c, /Max-Age=600/);
    const value = decodeURIComponent(pair(c).split('=')[1]);
    assert.equal(value.split('.').length, 5, 'JWE compact serialisation (encrypted)');
    assert.ok(!value.includes(p.get('state')) && !value.includes(p.get('nonce')), 'state and nonce are not readable from the cookie');
  });

  test('start validation: CSRF header required; `next` must be an internal path', async () => {
    assert.equal((await api('POST', '/api/v1/auth/google/start', { body: {}, client: null })).status, 403);
    for (const next of ['https://evil.example/x', '//evil.example', '/\\evil', 'patient']) {
      const res = await api('POST', '/api/v1/auth/google/start', { body: { next } });
      assert.equal(res.status, 400, next);
    }
    assert.equal((await api('POST', '/api/v1/auth/google/start', { body: { extra: 1 } })).status, 400, 'strict body');
  });

  test('new Google user: PATIENT only, no password, verified email, refresh cookie (no tokens in URL), rotation + reuse detection', async () => {
    const sub = `sub-${uniq()}`;
    const email = `New.${uniq()}@Gmail.test`;
    const res = await googleSignIn({ profile: { sub, email, name: '  Faadumo   Cali ' } }, { next: '/patient/doctors' });
    assert.equal(res.status, 303);
    assert.equal(res.location, `${base}/auth/google/complete?next=${encodeURIComponent('/patient/doctors')}`);
    assert.ok(!/token|code=|eyJ/i.test(res.location), 'no token or code in the redirect');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.match(res.oauthCookie, /fd_oauth=;/, 'one-time OAuth cookie cleared');
    assert.match(res.refreshCookie, /HttpOnly/i);
    assert.match(res.refreshCookie, /SameSite=Strict/i);
    assert.match(res.refreshCookie, /Path=\/api\/v1\/auth/);

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { roles: { include: { role: true } }, patientProfile: true, doctorProfile: true, identities: true } });
    assert.ok(user, 'account created with the lower-cased email');
    assert.equal(user.fullName, 'Faadumo Cali');
    assert.equal(user.passwordHash, null);
    assert.ok(user.emailVerifiedAt);
    assert.deepEqual(user.roles.map((r) => r.role.name), ['PATIENT']);
    assert.ok(user.patientProfile);
    assert.equal(user.doctorProfile, null);
    assert.equal(user.identities.length, 1);
    assert.equal(user.identities[0].providerSubject, sub);
    assert.equal(user.identities[0].provider, 'GOOGLE');
    assert.ok(await prisma.auditLog.findFirst({ where: { entityType: 'User', entityId: user.id, action: 'CREATE' } }));

    // The refresh cookie works with the existing rotation; the old one is then detected as reused.
    const first = pair(res.refreshCookie);
    const refreshed = await api('POST', '/api/v1/auth/refresh', { cookie: first, body: {} });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.data.activeRole, 'PATIENT');
    assert.deepEqual(refreshed.body.data.roles, ['PATIENT']);
    assert.ok(refreshed.body.data.accessToken);
    assert.equal(refreshed.body.data.refreshToken, undefined, 'web: refresh token only in the cookie');
    assert.notEqual(pair(refreshed.refreshCookie), first, 'rotated');
    const me = await api('GET', '/api/v1/auth/me', { token: refreshed.body.data.accessToken });
    assert.equal(me.body.data.user.id, user.id);
    const reused = await api('POST', '/api/v1/auth/refresh', { cookie: first, body: {} });
    assert.equal(reused.status, 401);
    assert.equal(reused.body.error.code, 'REFRESH_TOKEN_REUSED');

    // No password exists, so password login fails exactly like a wrong password.
    const pw = await api('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD } });
    assert.equal(pw.status, 401);
    assert.equal(pw.body.error.code, 'INVALID_CREDENTIALS');
  });

  test('linked account signs in by `sub` (even after its Google email changes); roles are preserved', async () => {
    const doctorUser = await prisma.user.create({
      data: {
        email: `doc-${uniq()}@fogaandawo.test`,
        fullName: 'Dr. Linked',
        passwordHash: await hashPassword(PASSWORD),
        roles: { create: [{ roleId: ctx.roles.PATIENT.id }, { roleId: ctx.roles.DOCTOR.id }] },
        patientProfile: { create: {} },
        doctorProfile: { create: { specialtyId: ctx.specialty.id, licenceNumber: `L-${uniq()}`, licenceCountry: 'Somalia', consultationFee: '20.00', verificationStatus: 'VERIFIED' } },
      },
    });
    const sub = `sub-${uniq()}`;
    await prisma.userIdentity.create({ data: { userId: doctorUser.id, provider: 'GOOGLE', providerSubject: sub, emailAtLink: 'old@gmail.test' } });
    const usersBefore = await prisma.user.count();

    const res = await googleSignIn({ profile: { sub, email: `renamed-${uniq()}@gmail.test` } });
    assert.equal(res.location, `${base}/auth/google/complete`);
    assert.equal(await prisma.user.count(), usersBefore, 'no new account');
    const session = await api('POST', '/api/v1/auth/refresh', { cookie: pair(res.refreshCookie), body: {} });
    assert.equal(session.body.data.user.id, doctorUser.id);
    assert.deepEqual(session.body.data.roles, ['PATIENT', 'DOCTOR'], 'existing roles preserved');
    assert.equal(session.body.data.activeRole, 'PATIENT', 'least-privileged usable role first, as with password login');
    const identity = await prisma.userIdentity.findFirst({ where: { providerSubject: sub } });
    assert.ok(identity.lastUsedAt);
    assert.equal((await prisma.user.findUnique({ where: { id: doctorUser.id } })).email, doctorUser.email, 'account email unchanged');
  });

  test('email collision: an existing account is never linked automatically', async () => {
    const { user, email } = await passwordUser();
    const res = await googleSignIn({ profile: { sub: `sub-${uniq()}`, email: email.toUpperCase() } });
    assert.equal(res.status, 303);
    assert.equal(errorOf(res), 'GOOGLE_EMAIL_EXISTS');
    assert.equal(res.refreshCookie, undefined, 'no session');
    assert.equal(await prisma.userIdentity.count({ where: { userId: user.id } }), 0);
  });

  test('linking from an authenticated session; then Google signs in to that account; sign-in methods reported', async () => {
    const { user, token } = await passwordUser();
    const before = await api('GET', '/api/v1/auth/methods', { token });
    assert.deepEqual(before.body.data.password, { enabled: true });
    assert.equal(before.body.data.google.connected, false);
    assert.equal(before.body.data.google.available, true);
    assert.equal(before.body.data.google.allowed, true);

    assert.equal((await api('POST', '/api/v1/auth/google/link', { body: {} })).status, 401, 'requires authentication');
    const sub = `sub-${uniq()}`;
    const gmail = `link-${uniq()}@gmail.test`;
    const res = await googleSignIn({ profile: { sub, email: gmail } }, { mode: 'link', token });
    assert.equal(res.location, `${base}/account/security?google=connected`);
    assert.equal(res.refreshCookie, undefined, 'linking does not create a new session');
    const identity = await prisma.userIdentity.findFirst({ where: { providerSubject: sub } });
    assert.equal(identity.userId, user.id);
    assert.equal(identity.emailAtLink, gmail);

    const methods = (await api('GET', '/api/v1/auth/methods', { token })).body.data;
    assert.equal(methods.google.connected, true);
    assert.equal(methods.google.email, gmail);
    assert.equal(methods.google.canDisconnect, true);
    assert.equal(JSON.stringify(methods).includes('passwordHash'), false);

    const login = await googleSignIn({ profile: { sub, email: gmail } });
    const session = await api('POST', '/api/v1/auth/refresh', { cookie: pair(login.refreshCookie), body: {} });
    assert.equal(session.body.data.user.id, user.id);
  });

  test('duplicate identities are refused: a Google account linked elsewhere, a second Google account, and the DB constraints', async () => {
    const owner = await passwordUser();
    const sub = `sub-${uniq()}`;
    await googleSignIn({ profile: { sub } }, { mode: 'link', token: owner.token });

    const other = await passwordUser();
    const res = await googleSignIn({ profile: { sub } }, { mode: 'link', token: other.token });
    assert.equal(errorOf(res), 'GOOGLE_ALREADY_LINKED');
    assert.equal(await prisma.userIdentity.count({ where: { userId: other.user.id } }), 0);

    const second = await api('POST', '/api/v1/auth/google/link', { token: owner.token, body: {} });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'GOOGLE_ALREADY_CONNECTED');

    await assert.rejects(prisma.userIdentity.create({ data: { userId: other.user.id, provider: 'GOOGLE', providerSubject: sub } }), /Unique constraint/);
    await assert.rejects(prisma.userIdentity.create({ data: { userId: owner.user.id, provider: 'GOOGLE', providerSubject: `sub-${uniq()}` } }), /Unique constraint/);
    await assert.rejects(prisma.userIdentity.create({ data: { userId: other.user.id, provider: 'GOOGLE', providerSubject: '' } }), /user_identities_subject_not_empty/);
  });

  test('linking is bound to a live session: revoked before the callback → refused', async () => {
    const { user, token, sessionId } = await passwordUser();
    const a = await authorize({ mode: 'link', token, plan: { profile: { sub: `sub-${uniq()}` } } });
    await prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
    const res = await callback(a.callbackPath, a.oauthCookie);
    assert.equal(errorOf(res), 'GOOGLE_LINK_SESSION_INVALID');
    assert.equal(await prisma.userIdentity.count({ where: { userId: user.id } }), 0);
  });

  test('disconnect: refused when Google is the only sign-in method; allowed when a password exists', async () => {
    const sub = `sub-${uniq()}`;
    const g = await googleSignIn({ profile: { sub } });
    const token = (await api('POST', '/api/v1/auth/refresh', { cookie: pair(g.refreshCookie), body: {} })).body.data.accessToken;
    const methods = (await api('GET', '/api/v1/auth/methods', { token })).body.data;
    assert.equal(methods.password.enabled, false);
    assert.equal(methods.google.canDisconnect, false);
    const refused = await api('DELETE', '/api/v1/auth/google', { token });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'LAST_SIGN_IN_METHOD');
    assert.equal(await prisma.userIdentity.count({ where: { providerSubject: sub } }), 1);

    const pw = await passwordUser();
    await googleSignIn({ profile: { sub: `sub-${uniq()}` } }, { mode: 'link', token: pw.token });
    assert.equal((await api('DELETE', '/api/v1/auth/google', { token: pw.token, client: null })).status, 403, 'CSRF header required');
    const ok = await api('DELETE', '/api/v1/auth/google', { token: pw.token });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.google.connected, false);
    assert.equal(await prisma.userIdentity.count({ where: { userId: pw.user.id } }), 0);
    assert.ok(await prisma.auditLog.findFirst({ where: { entityType: 'UserIdentity', action: 'DELETE', actorUserId: pw.user.id } }));
    const again = await api('DELETE', '/api/v1/auth/google', { token: pw.token });
    assert.equal(again.status, 404);
    assert.equal(again.body.error.code, 'GOOGLE_NOT_CONNECTED');
  });

  test('ADMIN is password-only: cannot link, and a linked identity cannot sign in an admin', async () => {
    const admin = await passwordUser({ roles: ['ADMIN'] });
    const link = await api('POST', '/api/v1/auth/google/link', { token: admin.token, body: {} });
    assert.equal(link.status, 403);
    assert.equal(link.body.error.code, 'GOOGLE_ADMIN_NOT_ALLOWED');
    assert.equal(link.oauthCookie, undefined);
    assert.equal((await api('GET', '/api/v1/auth/methods', { token: admin.token })).body.data.google.allowed, false);

    // e.g. ADMIN granted after Google was connected
    const sub = `sub-${uniq()}`;
    await prisma.userIdentity.create({ data: { userId: admin.user.id, provider: 'GOOGLE', providerSubject: sub } });
    const sessionsBefore = await prisma.session.count({ where: { userId: admin.user.id } });
    const res = await googleSignIn({ profile: { sub } });
    assert.equal(errorOf(res), 'GOOGLE_ADMIN_NOT_ALLOWED');
    assert.equal(res.refreshCookie, undefined);
    assert.equal(await prisma.session.count({ where: { userId: admin.user.id } }), sessionsBefore);
  });

  test('suspended and disabled accounts are refused exactly as with password sign-in', async () => {
    for (const status of ['SUSPENDED', 'DISABLED']) {
      const { user } = await passwordUser({ status });
      const sub = `sub-${uniq()}`;
      await prisma.userIdentity.create({ data: { userId: user.id, provider: 'GOOGLE', providerSubject: sub } });
      const res = await googleSignIn({ profile: { sub } });
      assert.equal(errorOf(res), status === 'SUSPENDED' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_DISABLED');
      assert.equal(res.refreshCookie, undefined);
      assert.equal(await prisma.session.count({ where: { userId: user.id } }), 0);
    }
  });

  test('invalid state: mismatched, missing cookie or tampered cookie → refused before any token exchange', async () => {
    const tokenCalls = google.stats.token;
    const a = await authorize({ plan: {} });
    const wrong = a.callbackPath.replace(/state=[^&]+/, 'state=forged');
    assert.equal(errorOf(await callback(wrong, a.oauthCookie)), 'GOOGLE_STATE_INVALID');

    const b = await authorize({ plan: {} });
    assert.equal(errorOf(await callback(b.callbackPath)), 'GOOGLE_STATE_INVALID', 'no cookie (e.g. login CSRF from another browser)');

    const c = await authorize({ plan: {} });
    const tampered = c.oauthCookie.slice(0, -4) + (c.oauthCookie.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    assert.equal(errorOf(await callback(c.callbackPath, tampered)), 'GOOGLE_STATE_INVALID');

    const d = await authorize({ plan: {} });
    const e = await authorize({ plan: {} });
    assert.equal(errorOf(await callback(d.callbackPath, e.oauthCookie)), 'GOOGLE_STATE_INVALID', "another attempt's cookie");
    assert.equal(google.stats.token, tokenCalls, 'Google token endpoint never called');
  });

  test('ID-token validation: nonce, audience, issuer, expiry, azp, signature and unverified email are all rejected', async () => {
    const usersBefore = await prisma.user.count();
    const now = Math.floor(Date.now() / 1000);
    const cases = [
      ['nonce', { overrides: { claims: { nonce: 'not-the-nonce' } } }, 'GOOGLE_FAILED'],
      ['missing nonce', { overrides: { claims: { nonce: undefined } } }, 'GOOGLE_FAILED'],
      ['audience', { overrides: { aud: 'someone-else.apps.googleusercontent.com' } }, 'GOOGLE_FAILED'],
      ['issuer', { overrides: { iss: 'https://evil.example' } }, 'GOOGLE_FAILED'],
      ['expired', { overrides: { iat: now - 7200, exp: now - 3600 } }, 'GOOGLE_FAILED'],
      ['azp', { overrides: { claims: { azp: 'other-client' } } }, 'GOOGLE_FAILED'],
      ['signature', { overrides: { rogueSignature: true } }, 'GOOGLE_FAILED'],
      ['unverified email', { profile: { email_verified: false } }, 'GOOGLE_EMAIL_UNVERIFIED'],
    ];
    for (const [name, plan, code] of cases) {
      const res = await googleSignIn({ ...plan, profile: { sub: `sub-${uniq()}`, ...plan.profile } });
      assert.equal(errorOf(res), code, name);
      assert.equal(res.refreshCookie, undefined, name);
    }
    assert.equal(await prisma.user.count(), usersBefore, 'no account created by any invalid token');
  });

  test('cancelled at Google → GOOGLE_CANCELLED', async () => {
    const res = await googleSignIn({ deny: true });
    assert.equal(errorOf(res), 'GOOGLE_CANCELLED');
    assert.equal(res.refreshCookie, undefined);
  });

  test('callback replay: the same callback (URL + cookie) is accepted only once', async () => {
    const sub = `sub-${uniq()}`;
    const a = await authorize({ plan: { profile: { sub } } });
    const first = await callback(a.callbackPath, a.oauthCookie);
    assert.ok(first.refreshCookie);
    const user = await prisma.user.findFirst({ where: { identities: { some: { providerSubject: sub } } } });
    const sessions = await prisma.session.count({ where: { userId: user.id } });
    const tokenCalls = google.stats.token;

    const replay = await callback(a.callbackPath, a.oauthCookie);
    assert.equal(errorOf(replay), 'GOOGLE_STATE_INVALID');
    assert.equal(replay.refreshCookie, undefined);
    assert.equal(await prisma.session.count({ where: { userId: user.id } }), sessions, 'no second session');
    assert.equal(google.stats.token, tokenCalls, 'replay stopped before the code exchange');
  });
});
