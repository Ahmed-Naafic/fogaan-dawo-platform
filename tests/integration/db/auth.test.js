// Authentication & authorization tests — real HTTP API against the configured Neon branch,
// isolated in a per-run schema (see harness.js). Never touches the `public` schema.
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';

const skip = databaseTestsSkipReason();
const ORIGIN = 'http://web.fogaan.test';
const PASSWORD = 'Correct-horse-42';

describe('auth API (Neon, isolated schema)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let server;
  let base;
  let tokens;
  let hashPassword;
  let seq = 0;

  before(async () => {
    process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url'); // per-run secret, never from .env
    process.env.BCRYPT_ROUNDS = '10';
    process.env.COOKIE_SECURE = 'false'; // plain http in tests; production default is Secure
    db = await setupTestDatabase();
    prisma = db.prisma;
    ctx = await baseData(prisma);
    tokens = await import('../../../apps/api/src/modules/auth/auth.tokens.js');
    ({ hashPassword } = await import('../../../apps/api/src/utils/password.js'));
    const { createApp } = await import('../../../apps/api/src/app.js');
    server = createApp({ corsOrigins: [ORIGIN], authRateLimit: { limit: 10_000 } }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((r) => (server ? server.close(r) : r()));
    await db?.teardown();
  });

  /* ------------------------------------------------------------ helpers */
  async function api(method, path, { body, token, cookie, client, url = base, headers = {} } = {}) {
    const res = await fetch(url + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(cookie ? { cookie } : {}),
        ...(client ? { 'x-fogaan-client': client } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const setCookies = res.headers.getSetCookie();
    const refreshCookie = setCookies.find((c) => c.startsWith('fd_refresh='));
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers, refreshCookie, cookie: refreshCookie?.split(';')[0] };
  }
  const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;
  const newEmail = () => `user-${uniq()}@Example.TEST`;
  const newPhone = () => `+25261${String(Date.now() + (seq += 1)).slice(-7)}`;
  const register = (over = {}) =>
    api('POST', '/api/v1/auth/register', { body: { fullName: 'Amina Cabdi', email: newEmail(), password: PASSWORD, passwordConfirmation: PASSWORD, ...over } });
  const loginNative = (email, extra = {}) => api('POST', '/api/v1/auth/login', { client: 'native', body: { email, password: PASSWORD, ...extra } });

  /** Creates a user directly (for roles that public registration can't grant). */
  async function createAccount({ roles, doctorStatus = 'ACTIVE', status = 'ACTIVE' }) {
    const email = `acct-${uniq()}@fogaandawo.test`;
    const user = await prisma.user.create({
      data: { email, fullName: 'Test Account', passwordHash: await hashPassword(PASSWORD), status, roles: { create: roles.map((r) => ({ roleId: ctx.roles[r].id })) } },
    });
    if (roles.includes('PATIENT')) await prisma.patientProfile.create({ data: { userId: user.id } });
    if (roles.includes('DOCTOR')) {
      await prisma.doctorProfile.create({
        data: { userId: user.id, specialtyId: ctx.specialty.id, licenceNumber: `L-${uniq()}`, licenceCountry: 'Somalia', consultationFee: '20.00', accountStatus: doctorStatus, verificationStatus: 'VERIFIED' },
      });
    }
    return { user, email };
  }

  /* -------------------------------------------------------------- tests */
  test('successful registration creates a PATIENT account atomically and signs the user in', async () => {
    const email = newEmail();
    const res = await register({ email, phone: '00252 61 555 0101', preferredLanguage: 'so' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const d = res.body.data;
    assert.equal(d.user.email, email.toLowerCase(), 'email normalised');
    assert.equal(d.user.phone, '+252615550101', 'phone normalised to E.164');
    assert.equal(d.user.preferredLanguage, 'so');
    assert.deepEqual(d.roles, ['PATIENT']);
    assert.equal(d.activeRole, 'PATIENT');
    assert.ok(d.profiles.patient?.id);
    assert.ok(d.accessToken && d.tokenType === 'Bearer' && d.expiresIn === 900);
    assert.equal(d.refreshToken, undefined, 'web clients never get the refresh token in the body');
    assert.ok(!JSON.stringify(res.body).includes('passwordHash') && !JSON.stringify(res.body).includes('$2b$'), 'no password hash in response');
    assert.match(res.refreshCookie, /HttpOnly/i);
    assert.match(res.refreshCookie, /SameSite=Strict/i);
    assert.match(res.refreshCookie, /Path=\/api\/v1\/auth/);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: d.user.id }, include: { roles: { include: { role: true } }, patientProfile: true } });
    assert.deepEqual(row.roles.map((r) => r.role.name), ['PATIENT']);
    assert.ok(row.patientProfile);
    assert.equal(await prisma.session.count({ where: { userId: row.id } }), 1);
  });

  test('password is stored as a bcrypt hash, never in plain text', async () => {
    const res = await register();
    const row = await prisma.user.findUniqueOrThrow({ where: { id: res.body.data.user.id } });
    assert.match(row.passwordHash, /^\$2b\$10\$/);
    assert.notEqual(row.passwordHash, PASSWORD);
    const bcrypt = (await import('bcrypt')).default;
    assert.ok(await bcrypt.compare(PASSWORD, row.passwordHash));
  });

  test('duplicate email is rejected (case-insensitive)', async () => {
    const email = newEmail();
    assert.equal((await register({ email })).status, 201);
    const dup = await register({ email: email.toUpperCase() });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'EMAIL_TAKEN');
  });

  test('duplicate phone is rejected (after normalisation)', async () => {
    const phone = newPhone();
    assert.equal((await register({ email: undefined, phone })).status, 201);
    const dup = await register({ email: undefined, phone: `00${phone.slice(1, 4)} ${phone.slice(4)}` });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'PHONE_TAKEN');
  });

  test('registration requires an email or a phone', async () => {
    const res = await register({ email: undefined, phone: '' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(res.body.error.details.some((d) => /email address or a phone/.test(d.message)));
  });

  test('invalid registration data is rejected without echoing values', async () => {
    const cases = [
      { password: 'short1', passwordConfirmation: 'short1' },
      { passwordConfirmation: 'Different-42' },
      { email: 'not-an-email' },
      { email: undefined, phone: '0612345678' },
      { fullName: ' ' },
      { role: 'ADMIN' }, // public registration can never grant a role
      { role: 'DOCTOR' }, // doctor sign-up is not a public registration option yet
    ];
    for (const over of cases) {
      const res = await register(over);
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(Object.keys(over))}`);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.ok(!JSON.stringify(res.body).includes(PASSWORD));
    }
    const malformed = await api('POST', '/api/v1/auth/register', { headers: { 'content-type': 'application/json' }, body: undefined });
    assert.equal(malformed.status, 400);
  });

  test('login with email and with phone returns tokens, profile, roles and active role', async () => {
    const email = newEmail();
    const phone = newPhone();
    await register({ email, phone });
    const byEmail = await api('POST', '/api/v1/auth/login', { body: { email: `  ${email.toUpperCase()} `, password: PASSWORD } });
    assert.equal(byEmail.status, 200, JSON.stringify(byEmail.body));
    assert.deepEqual(byEmail.body.data.roles, ['PATIENT']);
    assert.equal(byEmail.body.data.activeRole, 'PATIENT');
    assert.ok(byEmail.cookie);
    const byPhone = await api('POST', '/api/v1/auth/login', { body: { phone: `00${phone.slice(1)}`, password: PASSWORD } });
    assert.equal(byPhone.status, 200);
    assert.equal(byPhone.body.data.user.id, byEmail.body.data.user.id);
  });

  test('wrong password and unknown account give the same generic error', async () => {
    const email = newEmail();
    await register({ email });
    const wrong = await api('POST', '/api/v1/auth/login', { body: { email, password: 'Wrong-password-1' } });
    const unknown = await api('POST', '/api/v1/auth/login', { body: { email: `nobody-${uniq()}@example.test`, password: PASSWORD } });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
    assert.deepEqual(wrong.body, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' } });
  });

  test('expired, tampered and missing access tokens are rejected', async () => {
    const reg = await register();
    const { user, session } = reg.body.data;
    const expired = await tokens.signAccessToken({ userId: user.id, sessionId: session.id, role: 'PATIENT' }, { expiresInSeconds: -60 });
    const r1 = await api('GET', '/api/v1/auth/me', { token: expired.token });
    assert.equal(r1.status, 401);
    assert.equal(r1.body.error.code, 'TOKEN_EXPIRED');
    const tampered = `${reg.body.data.accessToken.slice(0, -4)}AAAA`;
    assert.equal((await api('GET', '/api/v1/auth/me', { token: tampered })).body.error.code, 'TOKEN_INVALID');
    assert.equal((await api('GET', '/api/v1/auth/me')).body.error.code, 'TOKEN_MISSING');
    const me = await api('GET', '/api/v1/auth/me', { token: reg.body.data.accessToken });
    assert.equal(me.status, 200);
    assert.ok(!JSON.stringify(me.body).includes('passwordHash'));
    assert.deepEqual(me.body.data.permissions.sort(), ['appointments:manage:own', 'consultations:join:own', 'doctor-application:manage:own', 'medical-documents:manage:participant', 'medical-history:manage:own', 'messages:own', 'prescriptions:read:own', 'profile:read:own', 'sessions:manage:own']);
  });

  test('invalid refresh tokens and missing client header are rejected', async () => {
    const garbage = await api('POST', '/api/v1/auth/refresh', { client: 'native', body: { refreshToken: 'v1.not-a-real-token-at-all-xxxxxxxxxxxxxxxx' } });
    assert.equal(garbage.status, 401);
    assert.equal(garbage.body.error.code, 'REFRESH_TOKEN_INVALID');
    const forged = await api('POST', '/api/v1/auth/refresh', {
      client: 'native',
      body: { refreshToken: `v1.00000000-0000-4000-8000-000000000000.PATIENT.${randomBytes(32).toString('base64url')}` },
    });
    assert.equal(forged.body.error.code, 'REFRESH_TOKEN_INVALID');
    const reg = await register();
    const noHeader = await api('POST', '/api/v1/auth/refresh', { cookie: reg.cookie });
    assert.equal(noHeader.status, 403);
    assert.equal(noHeader.body.error.code, 'CLIENT_HEADER_REQUIRED');
  });

  test('refresh rotates the token (native body and web cookie)', async () => {
    const email = newEmail();
    await register({ email });
    const login = await loginNative(email);
    const first = login.body.data.refreshToken;
    assert.ok(first, 'native clients receive the refresh token in the body');
    const rotated = await api('POST', '/api/v1/auth/refresh', { client: 'native', body: { refreshToken: first } });
    assert.equal(rotated.status, 200, JSON.stringify(rotated.body));
    assert.notEqual(rotated.body.data.refreshToken, first);
    assert.equal(rotated.body.data.session.id, login.body.data.session.id, 'same session, new token');
    const session = await prisma.session.findUniqueOrThrow({ where: { id: login.body.data.session.id } });
    assert.notEqual(session.refreshTokenHash, tokens.hashToken(first));
    assert.equal(session.refreshTokenHash, tokens.hashToken(rotated.body.data.refreshToken), 'only the hash is stored');

    const web = await register();
    const viaCookie = await api('POST', '/api/v1/auth/refresh', { client: 'web', cookie: web.cookie });
    assert.equal(viaCookie.status, 200);
    assert.ok(viaCookie.cookie && viaCookie.cookie !== web.cookie, 'new cookie issued');
    assert.equal(viaCookie.body.data.refreshToken, undefined);
  });

  test('reusing a rotated refresh token revokes the session', async () => {
    const email = newEmail();
    await register({ email });
    const login = await loginNative(email);
    const old = login.body.data.refreshToken;
    const fresh = (await api('POST', '/api/v1/auth/refresh', { client: 'native', body: { refreshToken: old } })).body.data;

    const replay = await api('POST', '/api/v1/auth/refresh', { client: 'native', body: { refreshToken: old } });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.error.code, 'REFRESH_TOKEN_REUSED');
    const session = await prisma.session.findUniqueOrThrow({ where: { id: login.body.data.session.id } });
    assert.ok(session.revokedAt, 'session revoked');

    assert.equal((await api('POST', '/api/v1/auth/refresh', { client: 'native', body: { refreshToken: fresh.refreshToken } })).body.error.code, 'SESSION_REVOKED');
    assert.equal((await api('GET', '/api/v1/auth/me', { token: fresh.accessToken })).body.error.code, 'SESSION_REVOKED');
    assert.equal((await api('POST', '/api/v1/auth/refresh', { client: 'native', body: { refreshToken: old } })).body.error.code, 'REFRESH_TOKEN_REUSED');
    assert.ok(await prisma.auditLog.findFirst({ where: { entityType: 'Session', entityId: session.id, action: 'OTHER' } }));
  });

  test('logout revokes the current session and clears the cookie', async () => {
    const reg = await register();
    const { accessToken } = reg.body.data;
    const out = await api('POST', '/api/v1/auth/logout', { client: 'web', token: accessToken, cookie: reg.cookie });
    assert.equal(out.status, 204);
    assert.match(out.refreshCookie, /fd_refresh=;/);
    assert.equal((await api('GET', '/api/v1/auth/me', { token: accessToken })).body.error.code, 'SESSION_REVOKED');
    assert.equal((await api('POST', '/api/v1/auth/refresh', { client: 'web', cookie: reg.cookie })).body.error.code, 'SESSION_REVOKED');
    assert.equal((await api('POST', '/api/v1/auth/logout', { client: 'web', cookie: reg.cookie })).status, 204, 'idempotent');
  });

  test('logout-all revokes every session of the user', async () => {
    const email = newEmail();
    await register({ email });
    const a = await loginNative(email);
    const b = await loginNative(email);
    const res = await api('POST', '/api/v1/auth/logout-all', { token: a.body.data.accessToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.revokedSessions, 3, 'registration session + two logins');
    for (const s of [a, b]) assert.equal((await api('GET', '/api/v1/auth/me', { token: s.body.data.accessToken })).status, 401);
    assert.equal(await prisma.session.count({ where: { userId: a.body.data.user.id, revokedAt: null } }), 0);
  });

  test('multiple-role users get all roles, least-privileged active by default', async () => {
    const { email } = await createAccount({ roles: ['DOCTOR', 'PATIENT'] });
    const def = await loginNative(email);
    assert.equal(def.status, 200, JSON.stringify(def.body));
    assert.deepEqual(def.body.data.roles, ['PATIENT', 'DOCTOR']);
    assert.equal(def.body.data.activeRole, 'PATIENT');
    assert.ok(def.body.data.profiles.patient && def.body.data.profiles.doctor);
    const asDoctor = await loginNative(email, { role: 'DOCTOR' });
    assert.equal(asDoctor.body.data.activeRole, 'DOCTOR');
    const asAdmin = await loginNative(email, { role: 'ADMIN' });
    assert.equal(asAdmin.status, 403);
    assert.equal(asAdmin.body.error.code, 'ROLE_NOT_ASSIGNED');
  });

  test('role switching changes the active role and survives refresh', async () => {
    const { email } = await createAccount({ roles: ['DOCTOR', 'PATIENT'] });
    const login = await loginNative(email);
    const sw = await api('POST', '/api/v1/auth/switch-role', { client: 'native', token: login.body.data.accessToken, body: { role: 'DOCTOR' } });
    assert.equal(sw.status, 200, JSON.stringify(sw.body));
    assert.equal(sw.body.data.activeRole, 'DOCTOR');
    assert.equal((await api('GET', '/api/v1/auth/me', { token: sw.body.data.accessToken })).body.data.activeRole, 'DOCTOR');
    const refreshed = await api('POST', '/api/v1/auth/refresh', { client: 'native', body: { refreshToken: sw.body.data.refreshToken } });
    assert.equal(refreshed.body.data.activeRole, 'DOCTOR');
    const back = await api('POST', '/api/v1/auth/switch-role', { client: 'native', token: refreshed.body.data.accessToken, body: { role: 'PATIENT' } });
    assert.equal(back.body.data.activeRole, 'PATIENT');
  });

  test('switching to an unassigned role is refused and grants nothing', async () => {
    const reg = await register();
    const userId = reg.body.data.user.id;
    const before = await prisma.userRole.count({ where: { userId } });
    for (const role of ['ADMIN', 'DOCTOR']) {
      const res = await api('POST', '/api/v1/auth/switch-role', { token: reg.body.data.accessToken, body: { role } });
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'ROLE_NOT_ASSIGNED');
    }
    assert.equal((await api('POST', '/api/v1/auth/switch-role', { token: reg.body.data.accessToken, body: { role: 'SUPERUSER' } })).status, 400);
    assert.equal(await prisma.userRole.count({ where: { userId } }), before);
  });

  test('admin endpoints: patients are refused, admins can grant ADMIN', async () => {
    const patient = await register();
    const target = await register();
    const path = `/api/v1/admin/users/${target.body.data.user.id}/roles`;
    assert.equal((await api('POST', path, { body: { role: 'ADMIN' } })).status, 401);
    const denied = await api('POST', path, { token: patient.body.data.accessToken, body: { role: 'ADMIN' } });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, 'ROLE_REQUIRED');

    const { email } = await createAccount({ roles: ['ADMIN', 'PATIENT'] });
    const asPatient = await loginNative(email);
    assert.equal((await api('POST', path, { token: asPatient.body.data.accessToken, body: { role: 'ADMIN' } })).status, 403, 'admin acting as PATIENT has no admin rights');
    const asAdmin = await loginNative(email, { role: 'ADMIN' });
    const granted = await api('POST', path, { token: asAdmin.body.data.accessToken, body: { role: 'ADMIN' } });
    assert.equal(granted.status, 201, JSON.stringify(granted.body));
    assert.deepEqual(granted.body.data.roles, ['PATIENT', 'ADMIN']);
    assert.equal((await api('POST', path, { token: asAdmin.body.data.accessToken, body: { role: 'DOCTOR' } })).status, 400, 'only ADMIN can be granted here');
    assert.equal((await api('POST', path, { token: asAdmin.body.data.accessToken, body: { role: 'ADMIN' } })).status, 409);
    assert.ok(await prisma.auditLog.findFirst({ where: { entityType: 'UserRole', entityId: target.body.data.user.id } }));
  });

  for (const status of ['SUSPENDED', 'DISABLED']) {
    test(`${status.toLowerCase()} users lose access immediately (token, refresh and login)`, async () => {
      const email = newEmail();
      await register({ email });
      const login = await loginNative(email);
      await prisma.user.update({ where: { id: login.body.data.user.id }, data: { status } });
      const code = status === 'SUSPENDED' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_DISABLED';

      const me = await api('GET', '/api/v1/auth/me', { token: login.body.data.accessToken });
      assert.equal(me.status, 403, 'a still-valid JWT is not enough');
      assert.equal(me.body.error.code, code);
      const refreshed = await api('POST', '/api/v1/auth/refresh', { client: 'native', body: { refreshToken: login.body.data.refreshToken } });
      assert.equal(refreshed.status, 403);
      assert.ok((await prisma.session.findUniqueOrThrow({ where: { id: login.body.data.session.id } })).revokedAt, 'session revoked');
      const again = await loginNative(email);
      assert.equal(again.status, 403);
      assert.equal(again.body.error.code, code);
    });
  }

  test('a suspended doctor loses doctor privileges but keeps the patient role', async () => {
    const { user, email } = await createAccount({ roles: ['DOCTOR', 'PATIENT'] });
    const login = await loginNative(email, { role: 'DOCTOR' });
    await prisma.doctorProfile.update({ where: { userId: user.id }, data: { accountStatus: 'SUSPENDED' } });

    const me = await api('GET', '/api/v1/auth/me', { token: login.body.data.accessToken });
    assert.equal(me.status, 403);
    assert.equal(me.body.error.code, 'ROLE_UNAVAILABLE');
    assert.equal((await loginNative(email, { role: 'DOCTOR' })).body.error.code, 'ROLE_UNAVAILABLE');
    const refreshed = await api('POST', '/api/v1/auth/refresh', { client: 'native', body: { refreshToken: login.body.data.refreshToken } });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.data.activeRole, 'PATIENT', 'falls back to a role that is still usable');
    const sw = await api('POST', '/api/v1/auth/switch-role', { token: refreshed.body.data.accessToken, body: { role: 'DOCTOR' } });
    assert.equal(sw.body.error.code, 'ROLE_UNAVAILABLE');
  });

  test('authentication endpoints are rate limited', async () => {
    const { createApp } = await import('../../../apps/api/src/app.js');
    const limited = createApp({ corsOrigins: [ORIGIN], authRateLimit: { limit: 3, windowMs: 60_000 } }).listen(0);
    await new Promise((r) => limited.once('listening', r));
    const url = `http://127.0.0.1:${limited.address().port}`;
    try {
      const statuses = [];
      for (let i = 0; i < 4; i += 1) statuses.push((await api('POST', '/api/v1/auth/login', { url, body: { email: 'x@example.test', password: 'Wrong-password-1' } })).status);
      assert.deepEqual(statuses, [401, 401, 401, 429]);
      const last = await api('POST', '/api/v1/auth/login', { url, body: { email: 'x@example.test', password: 'Wrong-password-1' } });
      assert.equal(last.body.error.code, 'RATE_LIMITED');
      assert.ok(last.headers.get('ratelimit-policy') || last.headers.get('ratelimit'));
    } finally {
      await new Promise((r) => limited.close(r));
    }
  });

  test('CORS allows only the configured origin, with credentials', async () => {
    const ok = await fetch(`${base}/api/v1/auth/login`, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST' } });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
    assert.match(ok.headers.get('access-control-allow-headers'), /X-Fogaan-Client/);
    const evil = await fetch(`${base}/api/v1/auth/login`, { method: 'OPTIONS', headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
    assert.equal(evil.status, 403);
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
  });
});

if (skip) test(`auth tests skipped: ${skip}`, { skip: true }, () => {});
