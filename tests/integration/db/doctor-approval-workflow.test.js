// Doctor application → admin approval workflow, verified end to end over HTTP.
// Runs against an isolated per-run schema (harness.js) — never the public schema. Numbers refer to the
// lifecycle checklist in the verification brief.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';

const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const ZONE = 'Africa/Mogadishu';
const SCHEDULE = { timeZone: ZONE, slotDurationMinutes: 30, days: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, periods: [{ startTime: '09:00', endTime: '11:00' }] })) };

describe('doctor approval workflow (Neon, isolated schema)', { skip: skip ?? false }, () => {
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
    process.env.PUBLIC_RATE_LIMIT_MAX = '10000';
    process.env.AVAILABILITY_RATE_LIMIT_MAX = '10000';
    storageDir = mkdtempSync(join(tmpdir(), 'fd-approval-'));
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
      headers: { 'x-fogaan-client': 'native', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, body: type.includes('application/json') ? await res.json() : Buffer.from(await res.arrayBuffer()), headers: res.headers };
  }
  const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;
  const login = async (email, role) => api('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD, ...(role ? { role } : {}) } });
  const roleNames = async (userId) => (await prisma.userRole.findMany({ where: { userId }, include: { role: true } })).map((r) => r.role.name).sort();
  const audits = (where) => prisma.auditLog.findMany({ where, orderBy: { createdAt: 'asc' } });

  /** 1–2: registers through the API exactly like the web "Doctor" option (a normal account), fills and submits. */
  async function applicant(name = `Dr. Applicant ${uniq()}`) {
    const email = `applicant-${uniq()}@example.test`;
    const reg = await api('POST', '/api/v1/auth/register', { body: { fullName: name, email, password: PASSWORD, passwordConfirmation: PASSWORD } });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    const token = reg.body.data.accessToken;
    const userId = reg.body.data.user.id;
    const save = await api('PUT', '/api/v1/doctor-application', {
      token,
      body: { professionalName: name, specialtyId: ctx.specialty.id, licenceNumber: `SMC-${uniq()}`, licenceCountry: 'Somalia', consultationFee: 25, bio: 'Cardiologist with nine years of clinical experience in Mogadishu and Hargeisa hospitals.', languages: ['so', 'en'] },
    });
    assert.equal(save.status, 200, JSON.stringify(save.body));
    const up = await api('POST', '/api/v1/doctor-application/documents/MEDICAL_LICENSE', { token, raw: PDF, headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'licence.pdf' } });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    return { email, token, userId, name };
  }
  const submit = (token) => api('POST', '/api/v1/doctor-application/submit', { token, body: {} });
  async function admin() {
    const email = `admin-${uniq()}@fogaandawo.test`;
    const user = await prisma.user.create({ data: { email, fullName: `Admin ${uniq()}`, passwordHash: await hashPassword(PASSWORD), roles: { create: [{ roleId: ctx.roles.ADMIN.id }] } } });
    const res = await login(email, 'ADMIN');
    assert.equal(res.status, 200);
    return { user, email, token: res.body.data.accessToken };
  }
  const doctorIdOf = async (userId) => (await prisma.doctorProfile.findUniqueOrThrow({ where: { userId } })).id;
  // Publicly listed = the public profile resolves (search additionally needs a free slot in the next 30 days).
  const listed = async (doctorId) => (await api('GET', `/api/v1/doctors/${doctorId}`)).status === 200;

  /* ------------------------------------------------------------ lifecycle: approval */

  test('1–10, 13: register → submit (PENDING) → no doctor access → admin reviews → approve → DOCTOR role → dashboard', async () => {
    const a = await applicant('Dr. Ayaan Warsame');
    assert.deepEqual(await roleNames(a.userId), ['PATIENT'], '1. registering as a doctor creates a normal account — no DOCTOR role');

    const draft = await api('GET', '/api/v1/doctor-application', { token: a.token });
    assert.equal(draft.body.data.status, 'NOT_SUBMITTED');
    const sub = await submit(a.token);
    assert.equal(sub.status, 200, `2. submission succeeds: ${JSON.stringify(sub.body)}`);

    const doctorId = await doctorIdOf(a.userId);
    const profile = await prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    const request = await prisma.verificationRequest.findFirstOrThrow({ where: { doctorId } });
    assert.equal(profile.verificationStatus, 'PENDING', '3. DoctorProfile PENDING');
    assert.equal(request.status, 'PENDING', '3. VerificationRequest PENDING');
    const mine = await api('GET', '/api/v1/doctor-application', { token: a.token });
    assert.equal(mine.body.data.status, 'PENDING', '4. applicant sees the status');
    assert.equal(mine.body.data.editable, false, '4. and the application is locked');

    // 5. no doctor features while pending
    assert.equal((await api('GET', '/api/v1/doctors/me', { token: a.token })).status, 403, '5. doctor profile API refused');
    assert.equal((await api('GET', '/api/v1/doctors/me/availability', { token: a.token })).status, 403, '5. availability refused');
    assert.equal((await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: a.token, body: SCHEDULE })).status, 403, '5. cannot publish availability');
    assert.equal((await login(a.email, 'DOCTOR')).body.error?.code, 'ROLE_NOT_ASSIGNED', '5. cannot sign in as DOCTOR');
    assert.equal((await api('POST', '/api/v1/auth/switch-role', { token: a.token, body: { role: 'DOCTOR' } })).status, 403, '5. cannot switch to DOCTOR');
    assert.equal(await listed(doctorId), false, 'pending doctor is not in public discovery');

    // 6–7. admin sees and inspects
    const adm = await admin();
    const pendingTab = await api('GET', '/api/v1/admin/doctor-applications?tab=pending', { token: adm.token });
    assert.equal(pendingTab.status, 200);
    assert.ok(pendingTab.body.data.items.some((i) => i.doctorId === doctorId && i.status === 'PENDING'), '6. listed under Pending');
    assert.ok(pendingTab.body.data.counts.pending >= 1);
    const detail = await api('GET', `/api/v1/admin/doctor-applications/${doctorId}`, { token: adm.token });
    assert.equal(detail.status, 200);
    const d = detail.body.data;
    assert.ok(d.professionalName === 'Dr. Ayaan Warsame' && d.licenceNumber && d.licenceCountry === 'Somalia' && d.consultationFee === '25.00' && d.bio && d.specialty?.nameEn, '7. professional details');
    assert.equal(d.applicant.email, a.email, '7. applicant contact for the reviewer');
    assert.equal(d.documents.length, 1);
    assert.ok(!JSON.stringify(d).includes('fileKey'), 'storage keys never leave the server');
    const file = await api('GET', `/api/v1/admin/doctor-applications/${doctorId}/documents/${d.documents[0].id}/file`, { token: adm.token });
    assert.equal(file.status, 200, '7. admin opens the licence');
    assert.match(file.headers.get('content-disposition'), /^attachment/);
    assert.match(file.headers.get('content-security-policy'), /sandbox/);
    assert.ok(Buffer.compare(file.body, PDF) === 0);

    // 8–9. approve
    assert.equal((await api('POST', `/api/v1/admin/doctor-applications/${doctorId}/start-review`, { token: adm.token, body: {} })).body.data.status, 'UNDER_REVIEW');
    const approve = await api('POST', `/api/v1/admin/doctor-applications/${doctorId}/approve`, { token: adm.token, body: { notes: 'Licence verified with the Somali Medical Council.' } });
    assert.equal(approve.status, 200, `8. approval: ${JSON.stringify(approve.body)}`);
    assert.deepEqual(await roleNames(a.userId), ['DOCTOR', 'PATIENT'], '9. DOCTOR role granted (PATIENT kept)');
    const approved = await prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } });
    assert.equal(approved.verificationStatus, 'VERIFIED');
    assert.ok(approved.verifiedAt);
    assert.equal((await prisma.verificationRequest.findUniqueOrThrow({ where: { id: request.id } })).status, 'APPROVED');
    assert.equal((await api('POST', `/api/v1/admin/doctor-applications/${doctorId}/reject`, { token: adm.token, body: { reason: 'Changing my mind after approval.' } })).body.error.code, 'INVALID_STATUS_TRANSITION', 'a decided application cannot be decided again');

    // 10. dashboard access
    const asDoctor = await login(a.email, 'DOCTOR');
    assert.equal(asDoctor.status, 200);
    assert.equal(asDoctor.body.data.activeRole, 'DOCTOR');
    const me = await api('GET', '/api/v1/doctors/me', { token: asDoctor.body.data.accessToken });
    assert.equal(me.status, 200, '10. doctor dashboard profile');
    assert.equal(me.body.data.status, 'VERIFIED');
    assert.equal((await api('GET', '/api/v1/doctors/me/availability', { token: asDoctor.body.data.accessToken })).body.data.canManage, true);
    assert.equal(await listed(doctorId), true, 'approved doctor appears in public discovery');
    const notified = await prisma.notification.findFirst({ where: { userId: a.userId } });
    assert.ok(notified, 'applicant is notified of the decision');

    // 13. audit trail
    const trail = await audits({ OR: [{ entityId: doctorId }, { entityId: a.userId }, { entityId: request.id }] });
    const has = (action, entityType, actor) => trail.some((l) => l.action === action && l.entityType === entityType && (actor === undefined || l.actorUserId === actor));
    assert.ok(has('CREATE', 'DoctorApplication', a.userId), '13. draft created (by the applicant)');
    assert.ok(has('CREATE', 'VerificationRequest', a.userId), '13. submission');
    assert.equal(trail.filter((l) => l.action === 'VERIFY' && l.actorUserId === adm.user.id).length, 2, '13. start-review and approval, by the admin');
    assert.ok(has('UPDATE', 'UserRole', adm.user.id), '13. DOCTOR role grant, by the admin');
    const docAudit = await audits({ entityType: 'DoctorDocument', actorUserId: a.userId });
    assert.equal(docAudit.length, 1, '13. document upload');
  });

  /* ------------------------------------------------------------ lifecycle: rejection */

  test('11–13: reject needs a reason, grants nothing, is audited; resubmission keeps the full history', async () => {
    const a = await applicant();
    await submit(a.token);
    const doctorId = await doctorIdOf(a.userId);
    const adm = await admin();

    const noReason = await api('POST', `/api/v1/admin/doctor-applications/${doctorId}/reject`, { token: adm.token, body: {} });
    assert.equal(noReason.status, 400, '11. a reason is required');
    const short = await api('POST', `/api/v1/admin/doctor-applications/${doctorId}/reject`, { token: adm.token, body: { reason: 'no' } });
    assert.equal(short.status, 400);
    const reason = 'The licence number does not match the uploaded certificate.';
    const rej = await api('POST', `/api/v1/admin/doctor-applications/${doctorId}/reject`, { token: adm.token, body: { reason } });
    assert.equal(rej.status, 200, '11. rejected with a reason');

    assert.deepEqual(await roleNames(a.userId), ['PATIENT'], '12. no DOCTOR role');
    assert.equal((await prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } })).verificationStatus, 'REJECTED');
    assert.equal((await api('GET', '/api/v1/doctors/me', { token: a.token })).status, 403, '12. no doctor dashboard');
    assert.equal((await login(a.email, 'DOCTOR')).status, 403, '12. cannot act as DOCTOR');
    assert.equal((await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: a.token, body: SCHEDULE })).status, 403, '12. cannot publish availability');
    assert.equal(await listed(doctorId), false, '12. not in public discovery');

    const mine = (await api('GET', '/api/v1/doctor-application', { token: a.token })).body.data;
    assert.equal(mine.status, 'REJECTED');
    assert.equal(mine.rejectionReason, reason, 'the applicant sees the reason');
    assert.equal(mine.editable, true, 'and may correct and resubmit');
    const rejectAudit = (await audits({ action: 'VERIFY', actorUserId: adm.user.id })).find((l) => JSON.stringify(l.newValues).includes('REJECT'));
    assert.ok(rejectAudit, `13. rejection audited: ${JSON.stringify(await audits({ actorUserId: adm.user.id }))}`);

    // Resubmit and approve: history is preserved, nothing is overwritten.
    assert.equal((await submit(a.token)).status, 200);
    await api('POST', `/api/v1/admin/doctor-applications/${doctorId}/approve`, { token: adm.token, body: {} });
    const requests = await prisma.verificationRequest.findMany({ where: { doctorId }, orderBy: { submittedAt: 'asc' }, include: { reviews: true } });
    assert.deepEqual(requests.map((r) => r.status), ['REJECTED', 'APPROVED'], 'every submission kept');
    assert.equal(requests[0].reviews[0].notes, reason, 'the rejection review and its reason are kept');
    const history = (await api('GET', `/api/v1/admin/doctor-applications/${doctorId}`, { token: adm.token })).body.data.history;
    assert.equal(history.length, 2, 'admin sees the whole verification history');
  });

  /* ------------------------------------------------------------ security */

  test('14: an administrator cannot approve or reject their own application', async () => {
    const a = await applicant();
    await submit(a.token);
    const doctorId = await doctorIdOf(a.userId);
    await prisma.userRole.create({ data: { userId: a.userId, roleId: ctx.roles.ADMIN.id } }); // the applicant is also an admin
    const asAdmin = (await login(a.email, 'ADMIN')).body.data.accessToken;
    for (const [path, body] of [['approve', {}], ['reject', { reason: 'Rejecting my own application.' }], ['start-review', {}]]) {
      const res = await api('POST', `/api/v1/admin/doctor-applications/${doctorId}/${path}`, { token: asAdmin, body });
      assert.equal(res.status, 403, path);
      assert.equal(res.body.error.code, 'SELF_REVIEW_FORBIDDEN');
    }
    assert.equal((await prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } })).verificationStatus, 'PENDING');
    assert.ok(!(await roleNames(a.userId)).includes('DOCTOR'));
  });

  test('only administrators acting as ADMIN can list, inspect, approve or reject', async () => {
    const a = await applicant();
    await submit(a.token);
    const doctorId = await doctorIdOf(a.userId);
    const other = await applicant();
    const adm = await admin();
    await prisma.userRole.create({ data: { userId: adm.user.id, roleId: ctx.roles.PATIENT.id } });
    await prisma.patientProfile.create({ data: { userId: adm.user.id } });
    const adminActingAsPatient = (await login(adm.email, 'PATIENT')).body.data.accessToken;
    const calls = [
      ['GET', '/api/v1/admin/doctor-applications?tab=pending', undefined],
      ['GET', `/api/v1/admin/doctor-applications/${doctorId}`, undefined],
      ['POST', `/api/v1/admin/doctor-applications/${doctorId}/approve`, {}],
      ['POST', `/api/v1/admin/doctor-applications/${doctorId}/reject`, { reason: 'Not an admin trying to reject.' }],
    ];
    for (const [method, path, body] of calls) {
      assert.equal((await api(method, path, { body })).status, 401, `anonymous ${method} ${path}`);
      assert.equal((await api(method, path, { token: other.token, body })).status, 403, `patient ${method} ${path}`);
      assert.equal((await api(method, path, { token: adminActingAsPatient, body })).status, 403, `admin acting as PATIENT ${method} ${path}`);
    }
    assert.equal((await prisma.doctorProfile.findUniqueOrThrow({ where: { id: doctorId } })).verificationStatus, 'PENDING', 'nothing changed');
  });

  test('users can never give themselves Admin or Doctor privileges', async () => {
    const email = `self-${uniq()}@example.test`;
    const withRole = await api('POST', '/api/v1/auth/register', { body: { fullName: 'Self Promoter', email, password: PASSWORD, passwordConfirmation: PASSWORD, role: 'ADMIN' } });
    assert.equal(withRole.status, 400, 'registration has no role field (strict)');
    const withRoles = await api('POST', '/api/v1/auth/register', { body: { fullName: 'Self Promoter', email, password: PASSWORD, passwordConfirmation: PASSWORD, roles: ['DOCTOR'] } });
    assert.equal(withRoles.status, 400);

    const a = await applicant();
    assert.equal((await login(a.email, 'ADMIN')).body.error.code, 'ROLE_NOT_ASSIGNED');
    assert.equal((await api('POST', '/api/v1/auth/switch-role', { token: a.token, body: { role: 'ADMIN' } })).status, 403);
    assert.equal((await api('POST', `/api/v1/admin/users/${a.userId}/roles`, { token: a.token, body: { role: 'ADMIN' } })).status, 403, 'patients cannot use the role-grant endpoint');
    const tamper = await api('PUT', '/api/v1/doctor-application', {
      token: a.token,
      body: { professionalName: a.name, specialtyId: ctx.specialty.id, licenceNumber: 'SMC-1', licenceCountry: 'Somalia', consultationFee: 25, bio: 'Cardiologist with nine years of clinical experience in Mogadishu and Hargeisa hospitals.', languages: ['so'], verificationStatus: 'VERIFIED' },
    });
    assert.equal(tamper.status, 400, 'status cannot be set through the application (mass assignment)');

    const adm = await admin();
    const grantDoctor = await api('POST', `/api/v1/admin/users/${a.userId}/roles`, { token: adm.token, body: { role: 'DOCTOR' } });
    assert.equal(grantDoctor.status, 400, 'even admins cannot hand out DOCTOR directly — only approval grants it');
    assert.deepEqual(await roleNames(a.userId), ['PATIENT']);
  });

  test('suspended doctors lose doctor access, cannot publish availability and leave public discovery', async () => {
    const a = await applicant();
    await submit(a.token);
    const doctorId = await doctorIdOf(a.userId);
    const adm = await admin();
    await api('POST', `/api/v1/admin/doctor-applications/${doctorId}/approve`, { token: adm.token, body: {} });
    const docToken = (await login(a.email, 'DOCTOR')).body.data.accessToken;
    assert.equal((await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: docToken, body: SCHEDULE })).status, 200);
    assert.equal(await listed(doctorId), true);

    const { suspendDoctor } = await import('../../../apps/api/src/modules/doctors/doctor.service.js');
    await suspendDoctor({ doctorId, adminUserId: adm.user.id, reason: 'Licence under investigation' });
    assert.equal((await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: docToken, body: SCHEDULE })).status, 403, 'existing DOCTOR session refused at once');
    assert.equal((await login(a.email, 'DOCTOR')).status, 403, 'cannot sign in as DOCTOR');
    assert.equal(await listed(doctorId), false, 'hidden from discovery');
    assert.equal((await api('GET', `/api/v1/doctors/${doctorId}/slots`)).status, 404, 'slots hidden');
    const patientLogin = await login(a.email);
    assert.equal(patientLogin.body.data.activeRole, 'PATIENT', 'keeps the patient account');
  });
});

if (skip) test(`doctor approval workflow tests skipped: ${skip}`, { skip: true }, () => {});
