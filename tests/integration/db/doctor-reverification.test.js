// Strict doctor re-verification (approved rule, Option A) — HTTP API + services against an isolated
// per-run schema (never the public schema). Scenarios A–G of the re-verification brief.
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';

const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const SCHEDULE = { timeZone: 'Africa/Mogadishu', slotDurationMinutes: 30, days: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, periods: [{ startTime: '09:00', endTime: '11:00' }] })) };
const LICENCE = { documentType: 'MEDICAL_LICENSE', fileName: 'licence.pdf', mimeType: 'application/pdf', fileSize: 1024 };

describe('strict doctor re-verification (Neon, isolated schema)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let server;
  let base;
  let hashPassword;
  let doctorService;
  let appointmentService;
  let seq = 0;

  before(async () => {
    process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
    process.env.BCRYPT_ROUNDS = '10';
    process.env.COOKIE_SECURE = 'false';
    process.env.UPLOAD_RATE_LIMIT_MAX = '1000';
    process.env.PUBLIC_RATE_LIMIT_MAX = '10000';
    process.env.AVAILABILITY_RATE_LIMIT_MAX = '10000';
    process.env.STORAGE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'fd-reverify-'));
    db = await setupTestDatabase();
    prisma = db.prisma;
    ctx = await baseData(prisma);
    ({ hashPassword } = await import('../../../apps/api/src/utils/password.js'));
    doctorService = await import('../../../apps/api/src/modules/doctors/doctor.service.js');
    appointmentService = await import('../../../apps/api/src/modules/appointments/appointment.service.js');
    const { createApp } = await import('../../../apps/api/src/app.js');
    server = createApp({ authRateLimit: { limit: 10_000 } }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((r) => (server ? server.close(r) : r()));
    await db?.teardown();
    (await import('node:fs')).rmSync(process.env.STORAGE_DIR, { recursive: true, force: true });
  });

  /* ------------------------------------------------------------ helpers */
  async function api(method, path, { body, raw, token, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'x-fogaan-client': 'native', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;
  const login = (email, role) => api('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD, ...(role ? { role } : {}) } });
  const roleNames = async (userId) => (await prisma.userRole.findMany({ where: { userId }, include: { role: true } })).map((r) => r.role.name).sort();
  const openSlots = (doctorId) => prisma.availabilitySlot.count({ where: { doctorId, status: 'AVAILABLE', startAtUtc: { gt: new Date() } } });
  const listed = async (doctorId) => (await api('GET', '/api/v1/doctors?pageSize=50')).body.data.items.some((d) => d.id === doctorId);

  async function adminSession() {
    const email = `admin-${uniq()}@fogaandawo.test`;
    const user = await prisma.user.create({ data: { email, fullName: `Admin ${uniq()}`, passwordHash: await hashPassword(PASSWORD), roles: { create: [{ roleId: ctx.roles.ADMIN.id }] } } });
    return { user, email, token: (await login(email, 'ADMIN')).body.data.accessToken };
  }

  /**
   * A doctor approved through the real workflow (register → apply → upload → submit → admin approves),
   * with published availability. Returns tokens and ids.
   */
  async function approvedDoctor(adm) {
    const email = `doc-${uniq()}@example.test`;
    const reg = await api('POST', '/api/v1/auth/register', { body: { fullName: 'Dr. Reverify', email, password: PASSWORD, passwordConfirmation: PASSWORD } });
    const patientToken = reg.body.data.accessToken;
    const userId = reg.body.data.user.id;
    await api('PUT', '/api/v1/doctor-application', {
      token: patientToken,
      body: { professionalName: `Dr. Reverify ${uniq()}`, specialtyId: ctx.specialty.id, licenceNumber: `SMC-${uniq()}`, licenceCountry: 'Somalia', consultationFee: 25, bio: 'Cardiologist with nine years of clinical experience in Mogadishu and Hargeisa hospitals.', languages: ['so', 'en'] },
    });
    await api('POST', '/api/v1/doctor-application/documents/MEDICAL_LICENSE', { token: patientToken, raw: PDF, headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'licence.pdf' } });
    await api('POST', '/api/v1/doctor-application/submit', { token: patientToken, body: {} });
    const doctorId = (await prisma.doctorProfile.findUniqueOrThrow({ where: { userId } })).id;
    const approved = await api('POST', `/api/v1/admin/doctor-applications/${doctorId}/approve`, { token: adm.token, body: {} });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    const doctorToken = (await login(email, 'DOCTOR')).body.data.accessToken;
    assert.equal((await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: doctorToken, body: SCHEDULE })).status, 200);
    return { email, userId, doctorId, doctorToken, patientToken };
  }
  /** The critical licence replacement (the internal service — no live replacement is ever done in production). */
  const replaceLicence = (doctorId, actorUserId, n = uniq()) => doctorService.addDocumentVersion({ doctorId, ...LICENCE, fileKey: `doctor-documents/${doctorId}/${n}.pdf`, actorUserId });

  /* ------------------------------------------------------------ A + B */

  test('A. critical licence replacement: DOCTOR removed, PATIENT kept, PENDING, slots withdrawn, hidden — atomically and audited', async () => {
    const adm = await adminSession();
    const d = await approvedDoctor(adm);
    const slotsBefore = await openSlots(d.doctorId);
    assert.ok(slotsBefore > 0);
    const requestsBefore = await prisma.verificationRequest.count({ where: { doctorId: d.doctorId } });
    const docsBefore = await prisma.doctorDocument.count({ where: { doctorId: d.doctorId } });

    const result = await replaceLicence(d.doctorId, d.userId);
    assert.ok(result.verificationRequest, 'a new verification request');
    assert.equal(result.privileges.doctorRoleRemoved, true);
    assert.equal(result.privileges.slotsWithdrawn, slotsBefore);
    assert.ok(result.privileges.availabilityRulesDeactivated > 0, 'weekly rules deactivated, so nothing is republished automatically');
    assert.equal(await prisma.availabilityRule.count({ where: { doctorId: d.doctorId, isActive: true } }), 0);

    assert.deepEqual(await roleNames(d.userId), ['PATIENT'], 'DOCTOR removed, PATIENT kept');
    assert.ok(await prisma.patientProfile.findUnique({ where: { userId: d.userId } }), 'patient profile kept');
    const profile = await prisma.doctorProfile.findUniqueOrThrow({ where: { id: d.doctorId } });
    assert.equal(profile.verificationStatus, 'PENDING');
    assert.equal(profile.verifiedAt, null);
    const requests = await prisma.verificationRequest.findMany({ where: { doctorId: d.doctorId }, orderBy: { submittedAt: 'asc' } });
    assert.equal(requests.length, requestsBefore + 1);
    assert.deepEqual(requests.map((r) => r.status), ['APPROVED', 'PENDING'], 'previous approval kept in history');
    const docs = await prisma.doctorDocument.findMany({ where: { doctorId: d.doctorId }, orderBy: { versionNumber: 'asc' } });
    assert.equal(docs.length, docsBefore + 1, 'previous licence version kept');
    assert.deepEqual(docs.map((x) => x.isCurrent), [false, true]);
    assert.equal(await openSlots(d.doctorId), 0, 'open slots withdrawn');
    assert.equal(await listed(d.doctorId), false, 'hidden from discovery');
    assert.equal((await api('GET', `/api/v1/doctors/${d.doctorId}/slots`)).status, 404);

    const roleAudit = await prisma.auditLog.findFirst({ where: { entityType: 'UserRole', entityId: d.userId, newValues: { path: ['revoked'], equals: 'DOCTOR' } } });
    assert.ok(roleAudit, 'role removal audited');
    assert.equal(roleAudit.newValues.slotsWithdrawn, slotsBefore);
    assert.ok(await prisma.auditLog.findFirst({ where: { entityType: 'VerificationRequest', entityId: result.verificationRequest.id, action: 'CREATE' } }), 're-verification start audited');
  });

  test('A. the replacement is atomic: if any step fails, nothing changes', async () => {
    const adm = await adminSession();
    const d = await approvedDoctor(adm);
    const slotsBefore = await openSlots(d.doctorId);
    const docsBefore = await prisma.doctorDocument.count({ where: { doctorId: d.doctorId } });
    // Force a failure AFTER the role was deleted and the slots withdrawn: the audit insert references an
    // actor that does not exist (foreign-key violation). Status, request, document, role and slots must
    // all roll back together.
    await assert.rejects(replaceLicence(d.doctorId, '00000000-0000-4000-8000-00000000dead'), /Foreign key|foreign key|constraint/i);
    assert.equal(await prisma.doctorDocument.count({ where: { doctorId: d.doctorId } }), docsBefore, 'no new document version');
    assert.deepEqual(await roleNames(d.userId), ['DOCTOR', 'PATIENT'], 'role untouched');
    assert.equal((await prisma.doctorProfile.findUniqueOrThrow({ where: { id: d.doctorId } })).verificationStatus, 'VERIFIED');
    assert.equal(await openSlots(d.doctorId), slotsBefore, 'slots untouched');
    assert.equal(await prisma.verificationRequest.count({ where: { doctorId: d.doctorId, status: 'PENDING' } }), 0);
  });

  test('B. while pending: patient access works; DOCTOR sign-in, switching, dashboard and availability are refused', async () => {
    const adm = await adminSession();
    const d = await approvedDoctor(adm);
    await replaceLicence(d.doctorId, d.userId);

    // existing DOCTOR session loses access on its very next request
    for (const [method, path, body] of [['GET', '/api/v1/doctors/me'], ['GET', '/api/v1/doctors/me/availability'], ['PUT', '/api/v1/doctors/me/availability/schedule', SCHEDULE], ['POST', '/api/v1/doctors/me/availability/blocks', { kind: 'DAYS', timeZone: 'Africa/Mogadishu', startDate: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10), endDate: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10) }]]) {
      assert.equal((await api(method, path, { token: d.doctorToken, body })).status, 403, `old doctor session: ${method} ${path}`);
    }
    assert.equal((await login(d.email, 'DOCTOR')).body.error.code, 'ROLE_NOT_ASSIGNED', 'DOCTOR sign-in refused');
    const asPatient = await login(d.email);
    assert.equal(asPatient.status, 200);
    assert.equal(asPatient.body.data.activeRole, 'PATIENT');
    assert.deepEqual(asPatient.body.data.roles, ['PATIENT']);
    const pt = asPatient.body.data.accessToken;
    assert.equal((await api('POST', '/api/v1/auth/switch-role', { token: pt, body: { role: 'DOCTOR' } })).status, 403, 'switching refused');
    assert.equal((await api('GET', '/api/v1/auth/me', { token: pt })).status, 200, 'patient access works');
    assert.equal((await api('GET', '/api/v1/doctor-application', { token: pt })).body.data.status, 'PENDING', 'sees the re-verification status');
    assert.equal((await api('GET', '/api/v1/doctors/me', { token: pt })).status, 403, 'dashboard API refused as patient too');
    assert.equal((await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: pt, body: SCHEDULE })).status, 403);
    assert.equal(await openSlots(d.doctorId), 0, 'no new slots can be created');
  });

  /* ------------------------------------------------------------ C + D + E */

  test('C–E. rejected → stays without DOCTOR; resubmission restores nothing; re-approval restores DOCTOR (slots not restored)', async () => {
    const adm = await adminSession();
    const d = await approvedDoctor(adm);
    await replaceLicence(d.doctorId, d.userId);

    // C. rejection
    const reason = 'The replacement licence scan is not legible.';
    const rej = await api('POST', `/api/v1/admin/doctor-applications/${d.doctorId}/reject`, { token: adm.token, body: { reason } });
    assert.equal(rej.status, 200, JSON.stringify(rej.body));
    assert.deepEqual(await roleNames(d.userId), ['PATIENT'], 'C. DOCTOR stays absent, PATIENT kept');
    assert.equal(await openSlots(d.doctorId), 0, 'C. slots remain withdrawn');
    assert.equal(await listed(d.doctorId), false, 'C. hidden from discovery');
    assert.equal((await login(d.email, 'DOCTOR')).status, 403, 'C. no doctor access');
    const pt = (await login(d.email)).body.data.accessToken;
    const mine = (await api('GET', '/api/v1/doctor-application', { token: pt })).body.data;
    assert.equal(mine.status, 'REJECTED');
    assert.equal(mine.rejectionReason, reason, 'C. reason preserved');
    const requests = await prisma.verificationRequest.findMany({ where: { doctorId: d.doctorId }, orderBy: { submittedAt: 'asc' }, include: { reviews: true } });
    assert.deepEqual(requests.map((r) => r.status), ['APPROVED', 'REJECTED'], 'C. previous requests kept');
    assert.ok(requests.every((r) => r.reviews.length >= 1), 'C. reviews kept');
    assert.ok((await prisma.auditLog.findMany({ where: { action: 'VERIFY', actorUserId: adm.user.id } })).some((l) => l.newValues?.reason === reason), 'C. rejection audited with the reason');

    // D. correct the document and resubmit through the existing workflow
    const upload = await api('POST', '/api/v1/doctor-application/documents/MEDICAL_LICENSE', { token: pt, raw: PDF, headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'licence-clear.pdf' } });
    assert.equal(upload.status, 201, `D. can upload a corrected licence: ${JSON.stringify(upload.body)}`);
    assert.equal((await api('POST', '/api/v1/doctor-application/submit', { token: pt, body: {} })).status, 200, 'D. can resubmit');
    assert.deepEqual(await roleNames(d.userId), ['PATIENT'], 'D. resubmission does not restore DOCTOR');
    assert.equal((await login(d.email, 'DOCTOR')).status, 403, 'D. doctor features remain inaccessible');
    assert.equal((await api('GET', '/api/v1/doctors/me', { token: pt })).status, 403);
    assert.equal(await listed(d.doctorId), false);

    // E. re-approval
    const ok = await api('POST', `/api/v1/admin/doctor-applications/${d.doctorId}/approve`, { token: adm.token, body: { notes: 'New licence verified.' } });
    assert.equal(ok.status, 200);
    assert.deepEqual(await roleNames(d.userId), ['DOCTOR', 'PATIENT'], 'E. DOCTOR restored, PATIENT kept');
    assert.equal((await prisma.doctorProfile.findUniqueOrThrow({ where: { id: d.doctorId } })).verificationStatus, 'VERIFIED');
    assert.equal(await openSlots(d.doctorId), 0, 'E. withdrawn slots are NOT restored automatically');
    assert.equal(await listed(d.doctorId), true, 'E. back in discovery');
    const dt = (await login(d.email, 'DOCTOR')).body.data.accessToken;
    assert.equal((await api('GET', '/api/v1/doctors/me', { token: dt })).status, 200, 'E. dashboard works');
    const republish = await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: dt, body: SCHEDULE });
    assert.equal(republish.status, 200, 'E. availability can be managed again');
    assert.ok((await openSlots(d.doctorId)) > 0, 'E. new availability is published');
    const history = await prisma.verificationRequest.findMany({ where: { doctorId: d.doctorId }, orderBy: { submittedAt: 'asc' } });
    assert.deepEqual(history.map((r) => r.status), ['APPROVED', 'REJECTED', 'APPROVED'], 'E. full history kept');
    assert.ok(await prisma.auditLog.findFirst({ where: { entityType: 'UserRole', entityId: d.userId, newValues: { path: ['granted'], equals: 'DOCTOR' }, createdAt: { gt: history[2].submittedAt } } }), 'E. role grant audited');
  });

  /* ------------------------------------------------------------ F. security */

  test('F. only admins decide; self-review is refused; concurrent operations stay consistent', async () => {
    const adm = await adminSession();
    const d = await approvedDoctor(adm);
    await replaceLicence(d.doctorId, d.userId);
    const pt = (await login(d.email)).body.data.accessToken;
    for (const token of [undefined, pt]) {
      assert.equal((await api('POST', `/api/v1/admin/doctor-applications/${d.doctorId}/approve`, { token, body: {} })).status, token ? 403 : 401);
      assert.equal((await api('POST', `/api/v1/admin/doctor-applications/${d.doctorId}/reject`, { token, body: { reason: 'Unauthorised rejection attempt.' } })).status, token ? 403 : 401);
    }
    // self-review: the doctor also holds ADMIN
    await prisma.userRole.create({ data: { userId: d.userId, roleId: ctx.roles.ADMIN.id } });
    const selfAdmin = (await login(d.email, 'ADMIN')).body.data.accessToken;
    const self = await api('POST', `/api/v1/admin/doctor-applications/${d.doctorId}/approve`, { token: selfAdmin, body: {} });
    assert.equal(self.body.error.code, 'SELF_REVIEW_FORBIDDEN');
    assert.ok(!(await roleNames(d.userId)).includes('DOCTOR'));

    // concurrent approve + reject by two admins: exactly one wins; role always matches the status
    const adm2 = await adminSession();
    const [a, b] = await Promise.all([
      api('POST', `/api/v1/admin/doctor-applications/${d.doctorId}/approve`, { token: adm.token, body: {} }),
      api('POST', `/api/v1/admin/doctor-applications/${d.doctorId}/reject`, { token: adm2.token, body: { reason: 'Concurrent rejection attempt here.' } }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], `one decision wins, the other is refused: ${a.status}/${b.status}`);
    const status = (await prisma.doctorProfile.findUniqueOrThrow({ where: { id: d.doctorId } })).verificationStatus;
    const hasDoctor = (await roleNames(d.userId)).includes('DOCTOR');
    assert.equal(hasDoctor, status === 'VERIFIED', `consistent: status=${status} doctorRole=${hasDoctor}`);
  });

  test('F. concurrent licence replacements open one re-verification and leave a consistent state', async () => {
    const adm = await adminSession();
    const d = await approvedDoctor(adm);
    const results = await Promise.allSettled([replaceLicence(d.doctorId, d.userId), replaceLicence(d.doctorId, d.userId)]);
    assert.ok(results.every((r) => r.status === 'fulfilled'), JSON.stringify(results.map((r) => r.reason?.message)));
    assert.equal(results.filter((r) => r.value.verificationRequest).length, 1, 'only the first replacement opens a request');
    assert.equal(await prisma.verificationRequest.count({ where: { doctorId: d.doctorId, status: 'PENDING' } }), 1);
    assert.deepEqual(await roleNames(d.userId), ['PATIENT']);
    assert.equal((await prisma.doctorDocument.count({ where: { doctorId: d.doctorId, isCurrent: true, documentType: 'MEDICAL_LICENSE' } })), 1, 'exactly one current licence');
    // a replacement racing an approval
    const [repl, appr] = await Promise.allSettled([replaceLicence(d.doctorId, d.userId), api('POST', `/api/v1/admin/doctor-applications/${d.doctorId}/approve`, { token: adm.token, body: {} })]);
    assert.equal(repl.status, 'fulfilled');
    const status = (await prisma.doctorProfile.findUniqueOrThrow({ where: { id: d.doctorId } })).verificationStatus;
    const hasDoctor = (await roleNames(d.userId)).includes('DOCTOR');
    assert.equal(hasDoctor, status === 'VERIFIED', `consistent after the race: status=${status} doctorRole=${hasDoctor} approval=${appr.value?.status}`);
  });

  /* ------------------------------------------------------------ G. regression */

  test('G. bookings and appointment records survive re-verification; suspension still works', async () => {
    const adm = await adminSession();
    const d = await approvedDoctor(adm);
    const patientUser = await prisma.user.create({ data: { email: `pt-${uniq()}@example.test`, fullName: 'Booking Patient', passwordHash: await hashPassword(PASSWORD), roles: { create: [{ roleId: ctx.roles.PATIENT.id }] } } });
    const patient = await prisma.patientProfile.create({ data: { userId: patientUser.id } });
    const slot = await prisma.availabilitySlot.findFirstOrThrow({ where: { doctorId: d.doctorId, status: 'AVAILABLE', startAtUtc: { gt: new Date(Date.now() + 864e5) } }, orderBy: { startAtUtc: 'asc' } });
    const held = await appointmentService.reserveSlot({ patientId: patient.id, slotId: slot.id });
    const appointmentId = held.appointment?.id ?? held.id;
    assert.ok(appointmentId, JSON.stringify(held));

    await replaceLicence(d.doctorId, d.userId);
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    assert.equal(appointment.status, 'PENDING_PAYMENT', 'the existing booking is untouched');
    assert.equal((await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: slot.id } })).status, 'HELD', 'its slot is kept');
    assert.equal(await openSlots(d.doctorId), 0, 'only open, unbooked slots were withdrawn');

    // suspension (existing behaviour) still works on another approved doctor
    const other = await approvedDoctor(adm);
    const res = await api('POST', `/api/v1/admin/doctors/${other.doctorId}/suspend`, { token: adm.token, body: { reason: 'Regression check of suspension.' } });
    assert.equal(res.status, 200);
    assert.equal((await prisma.doctorProfile.findUniqueOrThrow({ where: { id: other.doctorId } })).accountStatus, 'SUSPENDED');
    assert.equal((await login(other.email, 'DOCTOR')).status, 403);
  });

  test('G. first-time application, rejection and approval are unchanged; patients register and sign in', async () => {
    const adm = await adminSession();
    const email = `new-${uniq()}@example.test`;
    const reg = await api('POST', '/api/v1/auth/register', { body: { fullName: 'New Applicant', email, password: PASSWORD, passwordConfirmation: PASSWORD } });
    assert.equal(reg.status, 201);
    assert.equal((await login(email)).status, 200, 'patient sign-in works');
    const token = reg.body.data.accessToken;
    await api('PUT', '/api/v1/doctor-application', { token, body: { professionalName: 'Dr. First Timer', specialtyId: ctx.specialty.id, licenceNumber: `SMC-${uniq()}`, licenceCountry: 'Somalia', consultationFee: 25, bio: 'Paediatrician with seven years of clinical experience in Mogadishu and Garowe hospitals.', languages: ['so'] } });
    await api('POST', '/api/v1/doctor-application/documents/MEDICAL_LICENSE', { token, raw: PDF, headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'licence.pdf' } });
    await api('POST', '/api/v1/doctor-application/submit', { token, body: {} });
    const doctorId = (await prisma.doctorProfile.findUniqueOrThrow({ where: { userId: reg.body.data.user.id } })).id;
    await api('POST', `/api/v1/admin/doctor-applications/${doctorId}/reject`, { token: adm.token, body: { reason: 'First-time rejection for the regression check.' } });
    assert.deepEqual(await roleNames(reg.body.data.user.id), ['PATIENT']);
    const roleAudits = await prisma.auditLog.count({ where: { entityType: 'UserRole', entityId: reg.body.data.user.id } });
    assert.equal(roleAudits, 0, 'a first-time rejection has no role to revoke and writes no revoke entry');
    await api('POST', '/api/v1/doctor-application/submit', { token, body: {} });
    assert.equal((await api('POST', `/api/v1/admin/doctor-applications/${doctorId}/approve`, { token: adm.token, body: {} })).status, 200);
    assert.deepEqual(await roleNames(reg.body.data.user.id), ['DOCTOR', 'PATIENT'], 'first-time approval grants DOCTOR');
  });
});

if (skip) test(`re-verification tests skipped: ${skip}`, { skip: true }, () => {});
