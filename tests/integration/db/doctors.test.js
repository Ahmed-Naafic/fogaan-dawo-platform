// Doctor Management tests — real HTTP API against the configured Neon branch, isolated in a per-run
// schema (see harness.js), with private document storage in a temporary directory.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';

const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);

describe('doctor management API (Neon, isolated schema)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let server;
  let base;
  let storageDir;
  let hashPassword;
  let seq = 0;

  before(async () => {
    process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
    process.env.BCRYPT_ROUNDS = '10';
    process.env.COOKIE_SECURE = 'false';
    process.env.UPLOAD_RATE_LIMIT_MAX = '1000';
    storageDir = mkdtempSync(join(tmpdir(), 'fd-docs-'));
    process.env.STORAGE_DIR = storageDir;
    db = await setupTestDatabase();
    prisma = db.prisma;
    ctx = await baseData(prisma);
    ({ hashPassword } = await import('../../../apps/api/src/utils/password.js'));
    const { createApp } = await import('../../../apps/api/src/app.js');
    server = createApp({ authRateLimit: { limit: 10_000 } }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((r) => (server ? server.close(r) : r()));
    await db?.teardown();
    rmSync(storageDir, { recursive: true, force: true });
  });

  /* ------------------------------------------------------------ helpers */
  async function api(method, path, { body, raw, token, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        'x-fogaan-client': 'native',
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const type = res.headers.get('content-type') ?? '';
    const payload = type.includes('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, body: payload, headers: res.headers };
  }
  const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;

  async function registerPatient() {
    const email = `applicant-${uniq()}@example.test`;
    const res = await api('POST', '/api/v1/auth/register', { body: { fullName: 'Hodan Axmed', email, password: PASSWORD, passwordConfirmation: PASSWORD } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { email, token: res.body.data.accessToken, refreshToken: res.body.data.refreshToken, userId: res.body.data.user.id };
  }
  async function createAccount(roles) {
    const email = `acct-${uniq()}@fogaandawo.test`;
    const user = await prisma.user.create({
      data: { email, fullName: `Admin ${uniq()}`, passwordHash: await hashPassword(PASSWORD), roles: { create: roles.map((r) => ({ roleId: ctx.roles[r].id })) } },
    });
    if (roles.includes('PATIENT')) await prisma.patientProfile.create({ data: { userId: user.id } });
    return { user, email };
  }
  const login = async (email, role) => (await api('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD, ...(role ? { role } : {}) } })).body.data;
  const validApplication = (over = {}) => ({
    professionalName: 'Dr. Hodan Axmed',
    specialtyId: ctx.specialty.id,
    licenceNumber: 'SMC-2019/0457',
    licenceCountry: 'Somalia',
    consultationFee: 25,
    bio: 'Board-certified cardiologist with nine years of clinical experience in Mogadishu and Nairobi.',
    yearsExperience: 9,
    languages: ['so', 'en'],
    ...over,
  });
  const upload = (token, type, bytes, { name = 'licence.pdf', contentType = 'application/pdf' } = {}) =>
    api('POST', `/api/v1/doctor-application/documents/${type}`, { token, raw: bytes, headers: { 'content-type': contentType, 'x-file-name': encodeURIComponent(name) } });
  /** A patient with a complete, submitted application. */
  async function submittedApplicant() {
    const p = await registerPatient();
    assert.equal((await api('PUT', '/api/v1/doctor-application', { token: p.token, body: validApplication() })).status, 200);
    assert.equal((await upload(p.token, 'MEDICAL_LICENSE', PDF)).status, 201);
    const sub = await api('POST', '/api/v1/doctor-application/submit', { token: p.token, body: {} });
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
    return { ...p, doctorId: sub.body.data.id };
  }
  let adminToken;
  const admin = async () => {
    if (!adminToken) adminToken = (await login((await createAccount(['ADMIN'])).email)).accessToken;
    return adminToken;
  };
  const rolesOf = async (userId) => (await prisma.userRole.findMany({ where: { userId }, include: { role: true } })).map((r) => r.role.name).sort();

  /* -------------------------------------------------------------- tests */
  test('specialties are listed publicly with English and Somali names', async () => {
    const res = await api('GET', '/api/v1/specialties');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.map((s) => [s.nameEn, s.nameSo]), [['Cardiology', 'Wadnaha']]);
  });

  test('application requires authentication and validates every field', async () => {
    assert.equal((await api('GET', '/api/v1/doctor-application')).status, 401);
    const p = await registerPatient();
    const cases = [
      [{ professionalName: '' }, 'professionalName'],
      [{ specialtyId: 'not-a-uuid' }, 'specialtyId'],
      [{ licenceNumber: '' }, 'licenceNumber'],
      [{ licenceNumber: 'AB<script>' }, 'licenceNumber'],
      [{ licenceCountry: '123' }, 'licenceCountry'],
      [{ consultationFee: 4.99 }, 'consultationFee'],
      [{ consultationFee: 200.01 }, 'consultationFee'],
      [{ consultationFee: 25.555 }, 'consultationFee'],
      [{ bio: 'Too short' }, 'bio'],
      [{ languages: [] }, 'languages'],
      [{ languages: ['xx'] }, 'languages.0'],
      [{ verificationStatus: 'VERIFIED' }, null], // strict: clients cannot set status or roles
    ];
    for (const [over, path] of cases) {
      const res = await api('PUT', '/api/v1/doctor-application', { token: p.token, body: validApplication(over) });
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(over)}`);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      if (path) assert.ok(res.body.error.details.some((d) => d.path === path), `${path} flagged: ${JSON.stringify(res.body.error.details)}`);
    }
    const unknown = await api('PUT', '/api/v1/doctor-application', { token: p.token, body: validApplication({ specialtyId: '00000000-0000-4000-8000-000000000000' }) });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error.code, 'SPECIALTY_NOT_FOUND');
    assert.equal(await prisma.doctorProfile.count({ where: { userId: p.userId } }), 0, 'nothing saved on invalid input');
  });

  test('saving creates a private draft application without granting the DOCTOR role', async () => {
    const p = await registerPatient();
    assert.equal((await api('GET', '/api/v1/doctor-application', { token: p.token })).body.data, null);
    const res = await api('PUT', '/api/v1/doctor-application', { token: p.token, body: validApplication() });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const app = res.body.data;
    assert.equal(app.status, 'NOT_SUBMITTED');
    assert.equal(app.editable, true);
    assert.equal(app.professionalName, 'Dr. Hodan Axmed');
    assert.equal(app.consultationFee, '25.00');
    assert.deepEqual(app.languages.sort(), ['en', 'so']);
    assert.equal(app.completion.readyToSubmit, false);
    assert.ok(app.completion.missing.some((m) => m.key === 'document:MEDICAL_LICENSE' && m.required));
    assert.deepEqual(await rolesOf(p.userId), ['PATIENT'], 'no DOCTOR role for applicants');
    const submit = await api('POST', '/api/v1/doctor-application/submit', { token: p.token, body: {} });
    assert.equal(submit.status, 409);
    assert.equal(submit.body.error.code, 'APPLICATION_INCOMPLETE');
    assert.deepEqual(submit.body.error.details.missing, ['document:MEDICAL_LICENSE']);
    assert.equal((await api('GET', `/api/v1/admin/doctor-applications/${app.id}`, { token: await admin() })).status, 404, 'drafts are not visible to admins');
  });

  test('document upload validates the real file type, size and emptiness', async () => {
    const fresh = await registerPatient();
    assert.equal((await upload(fresh.token, 'MEDICAL_LICENSE', PDF)).body.error.code, 'APPLICATION_NOT_FOUND', 'details must be saved first');

    const p = await registerPatient();
    await api('PUT', '/api/v1/doctor-application', { token: p.token, body: validApplication() });
    const empty = await upload(p.token, 'MEDICAL_LICENSE', Buffer.alloc(0));
    assert.equal(empty.status, 400);
    const disguised = await upload(p.token, 'MEDICAL_LICENSE', Buffer.from('hello, I am not really a PDF file'), { name: 'licence.pdf', contentType: 'application/pdf' });
    assert.equal(disguised.status, 415, 'browser MIME type and extension are not trusted');
    assert.equal(disguised.body.error.code, 'FILE_TYPE_NOT_ALLOWED');
    const exe = await upload(p.token, 'MEDICAL_LICENSE', Buffer.concat([Buffer.from('MZ'), randomBytes(200)]), { name: 'licence.exe', contentType: 'application/octet-stream' });
    assert.equal(exe.status, 415);
    const big = await upload(p.token, 'MEDICAL_LICENSE', Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]));
    assert.equal(big.status, 413);
    assert.equal((await upload(p.token, 'OTHER_THING', PDF)).status, 400, 'unknown document type');
    assert.equal(await prisma.doctorDocument.count(), 0, 'no rejected file was recorded');
  });

  test('accepted uploads use the detected type, a sanitised name and keep every version', async () => {
    const p = await registerPatient();
    await api('PUT', '/api/v1/doctor-application', { token: p.token, body: validApplication() });
    const v1 = await upload(p.token, 'MEDICAL_LICENSE', PDF, { name: '../../etc/passwd<script>.exe', contentType: 'image/png' });
    assert.equal(v1.status, 201, JSON.stringify(v1.body));
    assert.equal(v1.body.data.mimeType, 'application/pdf', 'type from file bytes, not the Content-Type header');
    assert.equal(v1.body.data.fileName, 'passwdscript.pdf');
    assert.equal('fileKey' in v1.body.data, false, 'storage key never exposed');
    const v2 = await upload(p.token, 'MEDICAL_LICENSE', PNG, { name: 'licence-scan.png', contentType: 'image/png' });
    assert.equal(v2.status, 201);
    assert.equal((await upload(p.token, 'IDENTITY_PROOF', JPEG, { name: 'passport.jpg', contentType: 'image/jpeg' })).body.data.mimeType, 'image/jpeg');

    const app = (await api('GET', '/api/v1/doctor-application', { token: p.token })).body.data;
    const licences = app.documentHistory.filter((d) => d.documentType === 'MEDICAL_LICENSE');
    assert.deepEqual(licences.map((d) => [d.versionNumber, d.isCurrent]), [[2, true], [1, false]], 'previous version preserved');
    assert.equal(app.documents.length, 2, 'one current licence + identity proof');
    assert.equal(app.status, 'NOT_SUBMITTED', 'replacing a draft licence does not open a verification request');
    const stored = await prisma.doctorDocument.findFirstOrThrow({ where: { id: v1.body.data.id } });
    assert.match(stored.fileKey, /^doctor-documents\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/);
    assert.ok(existsSync(join(storageDir, ...stored.fileKey.split('/'))), 'file stored in private storage');
  });

  test('documents are private: owner and admins only', async () => {
    const owner = await submittedApplicant();
    const other = await registerPatient();
    const doc = (await api('GET', '/api/v1/doctor-application', { token: owner.token })).body.data.documents[0];

    const mine = await api('GET', `/api/v1/doctor-application/documents/${doc.id}/file`, { token: owner.token });
    assert.equal(mine.status, 200);
    assert.ok(Buffer.compare(mine.body, PDF) === 0, 'exact bytes returned');
    assert.equal(mine.headers.get('content-type'), 'application/pdf');
    assert.match(mine.headers.get('content-disposition'), /^attachment;/);
    assert.equal(mine.headers.get('content-security-policy'), "default-src 'none'; sandbox");
    assert.equal(mine.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(mine.headers.get('cache-control'), 'no-store');

    assert.equal((await api('GET', `/api/v1/doctor-application/documents/${doc.id}/file`, { token: other.token })).status, 404, "another user's document is invisible");
    assert.equal((await api('GET', `/api/v1/doctor-application/documents/${doc.id}/file`)).status, 401);
    assert.equal((await api('GET', `/api/v1/admin/doctor-applications/${owner.doctorId}/documents/${doc.id}/file`, { token: other.token })).status, 403, 'patients cannot use admin routes');
    const asAdmin = await api('GET', `/api/v1/admin/doctor-applications/${owner.doctorId}/documents/${doc.id}/file`, { token: await admin() });
    assert.equal(asAdmin.status, 200);
    assert.ok(Buffer.compare(asAdmin.body, PDF) === 0);
  });

  test('submitted applications are locked and give no doctor access', async () => {
    const p = await submittedApplicant();
    const app = (await api('GET', '/api/v1/doctor-application', { token: p.token })).body.data;
    assert.equal(app.status, 'PENDING');
    assert.equal(app.latestRequest.status, 'PENDING');
    assert.equal(app.editable, false);
    assert.equal((await api('PUT', '/api/v1/doctor-application', { token: p.token, body: validApplication({ consultationFee: 10 }) })).body.error.code, 'APPLICATION_LOCKED');
    assert.equal((await upload(p.token, 'QUALIFICATION', PDF)).body.error.code, 'APPLICATION_LOCKED');
    assert.equal((await api('POST', '/api/v1/doctor-application/submit', { token: p.token, body: {} })).body.error.code, 'APPLICATION_LOCKED');
    assert.deepEqual(await rolesOf(p.userId), ['PATIENT']);
    const me = await api('GET', '/api/v1/doctors/me', { token: p.token });
    assert.equal(me.status, 403, 'pending applicant cannot open doctor features');
    assert.equal(me.body.error.code, 'ROLE_REQUIRED');
    assert.equal((await api('POST', '/api/v1/auth/login', { body: { email: p.email, password: PASSWORD, role: 'DOCTOR' } })).body.error.code, 'ROLE_NOT_ASSIGNED');
    assert.equal((await api('GET', '/api/v1/admin/doctor-applications', { token: p.token })).status, 403, 'applicants cannot list applications');
  });

  test('only administrators can review, and never their own application', async () => {
    const p = await submittedApplicant();
    const plainDoctor = await createAccount(['PATIENT']);
    for (const token of [p.token, (await login(plainDoctor.email)).accessToken]) {
      for (const action of ['start-review', 'approve']) {
        const res = await api('POST', `/api/v1/admin/doctor-applications/${p.doctorId}/${action}`, { token, body: {} });
        assert.equal(res.status, 403);
      }
    }
    const adminPatient = await createAccount(['ADMIN', 'PATIENT']);
    const asPatient = (await login(adminPatient.email, 'PATIENT')).accessToken;
    await api('PUT', '/api/v1/doctor-application', { token: asPatient, body: validApplication() });
    await upload(asPatient, 'MEDICAL_LICENSE', PDF);
    const own = (await api('POST', '/api/v1/doctor-application/submit', { token: asPatient, body: {} })).body.data;
    const asAdmin = (await login(adminPatient.email, 'ADMIN')).accessToken;
    const self = await api('POST', `/api/v1/admin/doctor-applications/${own.id}/approve`, { token: asAdmin, body: {} });
    assert.equal(self.status, 403);
    assert.equal(self.body.error.code, 'SELF_REVIEW_FORBIDDEN');
    assert.equal(await prisma.verificationReview.count({ where: { request: { doctorId: own.id } } }), 0);
    assert.deepEqual(await rolesOf(adminPatient.user.id), ['ADMIN', 'PATIENT']);
  });

  test('rejection needs a reason, grants nothing, keeps history and allows resubmission', async () => {
    const p = await submittedApplicant();
    const token = await admin();
    const list = await api('GET', '/api/v1/admin/doctor-applications?tab=pending', { token });
    assert.ok(list.body.data.items.some((i) => i.doctorId === p.doctorId && i.status === 'PENDING'));
    assert.ok(list.body.data.counts.pending >= 1);

    const review = await api('POST', `/api/v1/admin/doctor-applications/${p.doctorId}/start-review`, { token, body: {} });
    assert.equal(review.body.data.status, 'UNDER_REVIEW');
    assert.ok((await api('GET', '/api/v1/admin/doctor-applications?tab=pending', { token })).body.data.items.some((i) => i.doctorId === p.doctorId && i.status === 'UNDER_REVIEW'), 'under review stays in the Pending tab');

    assert.equal((await api('POST', `/api/v1/admin/doctor-applications/${p.doctorId}/reject`, { token, body: {} })).status, 400);
    assert.equal((await api('POST', `/api/v1/admin/doctor-applications/${p.doctorId}/reject`, { token, body: { reason: 'short' } })).status, 400);
    const reason = 'The licence scan is unreadable. Please upload a clear copy.';
    const rejected = await api('POST', `/api/v1/admin/doctor-applications/${p.doctorId}/reject`, { token, body: { reason } });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    assert.equal(rejected.body.data.status, 'REJECTED');
    assert.deepEqual(await rolesOf(p.userId), ['PATIENT'], 'rejection grants no role');

    const mine = (await api('GET', '/api/v1/doctor-application', { token: p.token })).body.data;
    assert.equal(mine.status, 'REJECTED');
    assert.equal(mine.rejectionReason, reason, 'applicant sees the reason');
    assert.equal(mine.editable, true);
    assert.ok(await prisma.notification.findFirst({ where: { userId: p.userId, title: { contains: 'needs changes' } } }));
    assert.ok((await api('GET', '/api/v1/admin/doctor-applications?tab=rejected', { token })).body.data.items.some((i) => i.doctorId === p.doctorId));

    assert.equal((await upload(p.token, 'MEDICAL_LICENSE', PNG, { name: 'clear-licence.png', contentType: 'image/png' })).status, 201);
    const resubmitted = await api('POST', '/api/v1/doctor-application/submit', { token: p.token, body: {} });
    assert.equal(resubmitted.body.data.status, 'PENDING');
    assert.equal(resubmitted.body.data.rejectionReason, null);
    const history = resubmitted.body.data.history;
    assert.equal(history.length, 2, 'both submissions kept');
    assert.deepEqual(history.map((h) => h.status), ['PENDING', 'REJECTED']);
    assert.deepEqual(history[1].reviews.map((r) => r.status), ['UNDER_REVIEW', 'REJECTED']);
    assert.equal(history[1].reviews[1].notes, reason);
  });

  test('approval grants the DOCTOR role, verifies the doctor and audits the administrator', async () => {
    const p = await submittedApplicant();
    const adminAccount = await createAccount(['ADMIN']);
    const token = (await login(adminAccount.email)).accessToken;
    const approved = await api('POST', `/api/v1/admin/doctor-applications/${p.doctorId}/approve`, { token, body: { notes: 'Licence confirmed with the Somali Medical Council.' } });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.data.status, 'VERIFIED');
    assert.ok(approved.body.data.verifiedAt);
    assert.deepEqual(await rolesOf(p.userId), ['DOCTOR', 'PATIENT']);
    assert.ok(await prisma.auditLog.findFirst({ where: { actorUserId: adminAccount.user.id, action: 'VERIFY', entityType: 'VerificationRequest' } }));
    assert.ok(await prisma.auditLog.findFirst({ where: { actorUserId: adminAccount.user.id, entityType: 'UserRole', entityId: p.userId } }));
    assert.equal(approved.body.data.history[0].reviews.at(-1).reviewer.id, adminAccount.user.id, 'history records the reviewer');
    assert.equal((await api('POST', `/api/v1/admin/doctor-applications/${p.doctorId}/approve`, { token, body: {} })).body.error.code, 'INVALID_STATUS_TRANSITION');
    assert.equal((await api('POST', `/api/v1/admin/doctor-applications/${p.doctorId}/reject`, { token, body: { reason: 'Changing my mind afterwards.' } })).body.error.code, 'INVALID_STATUS_TRANSITION');

    // The applicant's session picks up the new role on refresh and can act as DOCTOR.
    const refreshed = (await api('POST', '/api/v1/auth/refresh', { body: { refreshToken: p.refreshToken } })).body.data;
    assert.deepEqual(refreshed.roles, ['PATIENT', 'DOCTOR']);
    const asDoctor = (await api('POST', '/api/v1/auth/switch-role', { token: refreshed.accessToken, body: { role: 'DOCTOR' } })).body.data;
    const me = await api('GET', '/api/v1/doctors/me', { token: asDoctor.accessToken });
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.equal(me.body.data.status, 'VERIFIED');
    assert.equal(me.body.data.specialty.nameEn, 'Cardiology');
    assert.equal(me.body.data.consultationFee, '25.00');
    assert.equal(me.body.data.documents.length, 1);
    assert.equal(me.body.data.completion.readyToSubmit, true);
    assert.equal((await api('GET', '/api/v1/doctors/me', { token: refreshed.accessToken })).status, 403, 'still requires acting in the DOCTOR role');
    const listed = (await api('GET', '/api/v1/admin/doctor-applications?tab=verified', { token })).body.data.items;
    assert.ok(listed.some((i) => i.doctorId === p.doctorId));
  });

  test('uploaded files live only in private storage', async () => {
    const files = readdirSync(join(storageDir, 'doctor-documents'), { recursive: true }).filter((f) => /\.(pdf|png|jpg)$/.test(f));
    assert.ok(files.length > 0);
    assert.ok(files.every((f) => /^[0-9a-f-]{36}[\\/][0-9a-f-]{36}\.(pdf|png|jpg)$/.test(f)), 'server-generated names only');
  });
});

if (skip) test(`doctor management tests skipped: ${skip}`, { skip: true }, () => {});
