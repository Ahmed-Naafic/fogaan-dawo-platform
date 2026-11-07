// Admin doctor management (list + suspend) and the re-verification investigation — HTTP API against an
// isolated per-run schema (never the public schema).
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';

const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';
const SCHEDULE = { timeZone: 'Africa/Mogadishu', slotDurationMinutes: 30, days: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, periods: [{ startTime: '09:00', endTime: '11:00' }] })) };

describe('admin doctor management (Neon, isolated schema)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let server;
  let base;
  let hashPassword;
  let services;
  let seq = 0;

  before(async () => {
    process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
    process.env.BCRYPT_ROUNDS = '10';
    process.env.COOKIE_SECURE = 'false';
    process.env.PUBLIC_RATE_LIMIT_MAX = '10000';
    process.env.AVAILABILITY_RATE_LIMIT_MAX = '10000';
    db = await setupTestDatabase();
    prisma = db.prisma;
    ctx = await baseData(prisma);
    ({ hashPassword } = await import('../../../apps/api/src/utils/password.js'));
    services = await import('../../../apps/api/src/modules/doctors/doctor.service.js');
    const { createApp } = await import('../../../apps/api/src/app.js');
    server = createApp({ authRateLimit: { limit: 10_000 } }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((r) => (server ? server.close(r) : r()));
    await db?.teardown();
  });

  async function api(method, path, { body, token } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'x-fogaan-client': 'native', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;
  const login = (email, role) => api('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD, ...(role ? { role } : {}) } });

  /** A user with the given roles and (optionally) a doctor profile in a given state. */
  async function account({ roles, doctor, name = `Dr. Test ${uniq()}` }) {
    const email = `acct-${uniq()}@fogaandawo.test`;
    const user = await prisma.user.create({ data: { email, fullName: name, passwordHash: await hashPassword(PASSWORD), roles: { create: roles.map((r) => ({ roleId: ctx.roles[r].id })) } } });
    if (roles.includes('PATIENT')) await prisma.patientProfile.create({ data: { userId: user.id } });
    let profile = null;
    if (doctor) {
      profile = await prisma.doctorProfile.create({
        data: {
          userId: user.id, specialtyId: ctx.specialty.id, licenceNumber: `LIC-${uniq()}`, licenceCountry: 'Somalia', consultationFee: '30.00', bio: 'Physician.',
          verificationStatus: doctor, verifiedAt: doctor === 'VERIFIED' ? new Date() : null, languages: { create: [{ language: 'so' }] },
        },
      });
    }
    return { user, email, profile };
  }
  async function adminSession() {
    const a = await account({ roles: ['ADMIN'], name: `Admin ${uniq()}` });
    return { ...a, token: (await login(a.email, 'ADMIN')).body.data.accessToken };
  }

  test('admins list registered doctors by status with professional details; drafts are excluded', async () => {
    const verified = await account({ roles: ['DOCTOR', 'PATIENT'], doctor: 'VERIFIED', name: 'Dr. Listed Verified' });
    const pending = await account({ roles: ['PATIENT'], doctor: 'PENDING', name: 'Dr. Listed Pending' });
    const draft = await account({ roles: ['PATIENT'], doctor: 'NOT_SUBMITTED', name: 'Dr. Draft Only' });
    const adm = await adminSession();

    const all = await api('GET', '/api/v1/admin/doctors?tab=all&pageSize=50', { token: adm.token });
    assert.equal(all.status, 200);
    const ids = all.body.data.items.map((d) => d.doctorId);
    assert.ok(ids.includes(verified.profile.id) && ids.includes(pending.profile.id));
    assert.ok(!ids.includes(draft.profile.id), 'drafts are applicants, not doctors');
    const row = all.body.data.items.find((d) => d.doctorId === verified.profile.id);
    assert.equal(row.verificationStatus, 'VERIFIED');
    assert.equal(row.accountStatus, 'ACTIVE');
    assert.equal(row.consultationFee, '30.00');
    assert.ok(row.licenceNumber && row.licenceCountry && row.specialty.nameEn && row.email);
    assert.deepEqual(Object.keys(all.body.data.counts).sort(), ['all', 'pending', 'rejected', 'suspended', 'verified']);

    const verifiedTab = (await api('GET', '/api/v1/admin/doctors?tab=verified&pageSize=50', { token: adm.token })).body.data.items;
    assert.ok(verifiedTab.every((d) => d.verificationStatus === 'VERIFIED' && d.accountStatus === 'ACTIVE'));
    const pendingTab = (await api('GET', '/api/v1/admin/doctors?tab=pending&pageSize=50', { token: adm.token })).body.data.items;
    assert.ok(pendingTab.some((d) => d.doctorId === pending.profile.id) && pendingTab.every((d) => ['PENDING', 'UNDER_REVIEW'].includes(d.verificationStatus)));
    const search = (await api('GET', '/api/v1/admin/doctors?q=listed%20verified', { token: adm.token })).body.data.items;
    assert.deepEqual(search.map((d) => d.doctorId), [verified.profile.id]);
    assert.equal((await api('GET', '/api/v1/admin/doctors?tab=everything', { token: adm.token })).status, 400);
  });

  test('only administrators acting as ADMIN can list or suspend doctors', async () => {
    const target = await account({ roles: ['DOCTOR'], doctor: 'VERIFIED' });
    const doctor = await account({ roles: ['DOCTOR'], doctor: 'VERIFIED' });
    const doctorToken = (await login(doctor.email, 'DOCTOR')).body.data.accessToken;
    const patient = await account({ roles: ['PATIENT'] });
    const patientToken = (await login(patient.email)).body.data.accessToken;
    const adm = await adminSession();
    await prisma.userRole.create({ data: { userId: adm.user.id, roleId: ctx.roles.PATIENT.id } });
    await prisma.patientProfile.create({ data: { userId: adm.user.id } });
    const adminAsPatient = (await login(adm.email, 'PATIENT')).body.data.accessToken;
    const body = { reason: 'Licence under investigation by the council.' };
    for (const token of [undefined, patientToken, doctorToken, adminAsPatient]) {
      const expected = token ? 403 : 401;
      assert.equal((await api('GET', '/api/v1/admin/doctors', { token })).status, expected);
      assert.equal((await api('POST', `/api/v1/admin/doctors/${target.profile.id}/suspend`, { token, body })).status, expected);
    }
    assert.equal((await prisma.doctorProfile.findUniqueOrThrow({ where: { id: target.profile.id } })).accountStatus, 'ACTIVE', 'nothing changed');
  });

  test('suspension requires a reason, reuses the suspension service, is audited and takes effect at once', async () => {
    const doc = await account({ roles: ['DOCTOR', 'PATIENT'], doctor: 'VERIFIED', name: 'Dr. To Suspend' });
    const docToken = (await login(doc.email, 'DOCTOR')).body.data.accessToken;
    assert.equal((await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: docToken, body: SCHEDULE })).status, 200);
    const adm = await adminSession();
    const path = `/api/v1/admin/doctors/${doc.profile.id}/suspend`;

    assert.equal((await api('POST', path, { token: adm.token, body: {} })).status, 400, 'reason required');
    assert.equal((await api('POST', path, { token: adm.token, body: { reason: 'short' } })).status, 400, 'reason too short');
    assert.equal((await api('POST', path, { token: adm.token, body: { reason: 'Licence under investigation.', accountStatus: 'ACTIVE' } })).status, 400, 'unknown fields rejected');

    const reason = 'Licence under investigation by the medical council.';
    const res = await api('POST', path, { token: adm.token, body: { reason } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.doctor.accountStatus, 'SUSPENDED');
    assert.equal(res.body.data.doctor.suspension.reason, reason);
    assert.equal(res.body.data.cancelledAppointments, 0);

    const audit = await prisma.auditLog.findMany({ where: { action: 'SUSPEND', entityType: 'DoctorProfile', entityId: doc.profile.id } });
    assert.equal(audit.length, 1, 'exactly one SUSPEND entry (from the existing service — no duplicate logic)');
    assert.equal(audit[0].actorUserId, adm.user.id);
    assert.equal(audit[0].newValues.reason, reason);
    assert.equal(audit[0].oldValues.accountStatus, 'ACTIVE');

    const again = await api('POST', path, { token: adm.token, body: { reason } });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'DOCTOR_ALREADY_SUSPENDED');

    assert.equal((await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: docToken, body: SCHEDULE })).status, 403, 'existing doctor session refused');
    assert.equal((await login(doc.email, 'DOCTOR')).status, 403, 'cannot sign in as DOCTOR');
    assert.equal((await login(doc.email)).body.data.activeRole, 'PATIENT', 'patient account kept');
    assert.ok(!(await api('GET', '/api/v1/doctors?pageSize=50')).body.data.items.some((d) => d.id === doc.profile.id), 'hidden from discovery');
    const suspendedTab = (await api('GET', '/api/v1/admin/doctors?tab=suspended', { token: adm.token })).body.data.items;
    assert.ok(suspendedTab.some((d) => d.doctorId === doc.profile.id && d.suspension?.reason === reason && d.suspension.by === adm.user.fullName));
  });

  test('admins cannot suspend their own doctor profile, and drafts or unknown ids are 404', async () => {
    const both = await account({ roles: ['ADMIN', 'DOCTOR'], doctor: 'VERIFIED' });
    const token = (await login(both.email, 'ADMIN')).body.data.accessToken;
    const self = await api('POST', `/api/v1/admin/doctors/${both.profile.id}/suspend`, { token, body: { reason: 'Suspending my own profile.' } });
    assert.equal(self.status, 403);
    assert.equal(self.body.error.code, 'SELF_ACTION_FORBIDDEN');
    const draft = await account({ roles: ['PATIENT'], doctor: 'NOT_SUBMITTED' });
    assert.equal((await api('POST', `/api/v1/admin/doctors/${draft.profile.id}/suspend`, { token, body: { reason: 'Not a doctor yet at all.' } })).status, 404);
    assert.equal((await api('POST', '/api/v1/admin/doctors/00000000-0000-4000-8000-000000000000/suspend', { token, body: { reason: 'Does not exist anywhere.' } })).status, 404);
    assert.equal((await prisma.doctorProfile.findUniqueOrThrow({ where: { id: both.profile.id } })).accountStatus, 'ACTIVE');
  });

  /* ------------------------------------------------------------ re-verification (formerly the investigation) */

  test('approved doctor → re-verification → rejected: DOCTOR privileges removed (approved rule)', async () => {
    const doc = await account({ roles: ['DOCTOR', 'PATIENT'], doctor: 'VERIFIED', name: 'Dr. Reverify' });
    const adm = await adminSession();
    let token = (await login(doc.email, 'DOCTOR')).body.data.accessToken;
    assert.equal((await api('PUT', '/api/v1/doctors/me/availability/schedule', { token, body: SCHEDULE })).status, 200);
    const slotsBefore = await prisma.availabilitySlot.count({ where: { doctorId: doc.profile.id, status: 'AVAILABLE', startAtUtc: { gt: new Date() } } });

    // Re-verification is triggered internally by replacing the licence (no HTTP route does this today).
    const lic = { documentType: 'MEDICAL_LICENSE', fileName: 'licence.pdf', mimeType: 'application/pdf', fileSize: 1024 };
    await services.addDocumentVersion({ doctorId: doc.profile.id, ...lic, fileKey: 'doctor-documents/x/v1.pdf' });
    await services.addDocumentVersion({ doctorId: doc.profile.id, ...lic, fileKey: 'doctor-documents/x/v2.pdf' });
    const during = await prisma.doctorProfile.findUniqueOrThrow({ where: { id: doc.profile.id } });
    const findings = { duringReverification: { verificationStatus: during.verificationStatus } };

    const rej = await api('POST', `/api/v1/admin/doctor-applications/${doc.profile.id}/reject`, { token: adm.token, body: { reason: 'The replacement licence is not legible.' } });
    assert.equal(rej.status, 200, JSON.stringify(rej.body));

    const roles = (await prisma.userRole.findMany({ where: { userId: doc.user.id }, include: { role: true } })).map((r) => r.role.name).sort();
    const loginAsDoctor = await login(doc.email, 'DOCTOR');
    token = loginAsDoctor.body?.data?.accessToken ?? token;
    findings.afterRejection = {
      verificationStatus: (await prisma.doctorProfile.findUniqueOrThrow({ where: { id: doc.profile.id } })).verificationStatus,
      roles,
      canSignInAsDoctor: loginAsDoctor.status === 200,
      doctorProfileApi: (await api('GET', '/api/v1/doctors/me', { token })).status,
      availabilityRead: (await api('GET', '/api/v1/doctors/me/availability', { token })).status,
      availabilityCanManage: (await api('GET', '/api/v1/doctors/me/availability', { token })).body?.data?.canManage,
      availabilityWrite: (await api('PUT', '/api/v1/doctors/me/availability/schedule', { token, body: SCHEDULE })).status,
      inPublicSearch: (await api('GET', '/api/v1/doctors?pageSize=50')).body.data.items.some((d) => d.id === doc.profile.id),
      publicProfile: (await api('GET', `/api/v1/doctors/${doc.profile.id}`)).status,
      openSlotsStillStored: await prisma.availabilitySlot.count({ where: { doctorId: doc.profile.id, status: 'AVAILABLE', startAtUtc: { gt: new Date() } } }),
      openSlotsBefore: slotsBefore,
      applicationEditable: (await api('GET', '/api/v1/doctor-application', { token: (await login(doc.email, 'PATIENT')).body.data.accessToken })).body.data.editable,
    };
    console.log(`[investigation] ${JSON.stringify(findings)}`);

    // Approved rule (Option A): re-verification removes DOCTOR privileges; rejection keeps them removed.
    assert.equal(findings.duringReverification.verificationStatus, 'PENDING');
    assert.equal(findings.afterRejection.verificationStatus, 'REJECTED');
    assert.deepEqual(findings.afterRejection.roles, ['PATIENT'], 'the DOCTOR role is removed; PATIENT kept');
    assert.equal(findings.afterRejection.canSignInAsDoctor, false, 'cannot act as DOCTOR');
    assert.equal(findings.afterRejection.doctorProfileApi, 403, 'doctor dashboard blocked');
    assert.equal(findings.afterRejection.availabilityRead, 403, 'availability blocked');
    assert.equal(findings.afterRejection.availabilityWrite, 403, 'publishing blocked');
    assert.equal(findings.afterRejection.inPublicSearch, false, 'not in public discovery');
    assert.equal(findings.afterRejection.publicProfile, 404);
    assert.equal(findings.afterRejection.openSlotsStillStored, 0, 'open slots withdrawn');
    assert.equal(findings.afterRejection.applicationEditable, true, 'may correct and resubmit');
  });
});

if (skip) test(`admin doctor management tests skipped: ${skip}`, { skip: true }, () => {});
