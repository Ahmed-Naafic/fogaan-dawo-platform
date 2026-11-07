// Patient & doctor profiles (Phase 9) — real HTTP API + services against an isolated per-run schema on
// the development database branch (never production). Covers: own-profile editing and mass-assignment
// protection, cross-patient isolation, longitudinal medical-history ownership and integrity triggers,
// doctor professional profile (fee → new bookings only), verification restrictions, licence replacement
// (Option A re-verification, no automatic slot restoration), availability gates, public field filtering,
// profile photos (EXIF stripped, private vs public) and password change session protection.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData, createCompletedConsultation } from './fixtures.js';

const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const SCHEDULE = { timeZone: 'Africa/Mogadishu', slotDurationMinutes: 30, days: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, periods: [{ startTime: '09:00', endTime: '11:00' }] })) };
const BIO = 'Family physician with ten years of experience in primary care, diabetes and hypertension.';

describe('patient & doctor profiles (development branch, isolated schema)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let server;
  let base;
  let hashPassword;
  let syncAllDoctorSlots;
  let seq = 0;

  before(async () => {
    process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
    process.env.BCRYPT_ROUNDS = '10';
    process.env.COOKIE_SECURE = 'false';
    process.env.UPLOAD_RATE_LIMIT_MAX = '1000';
    process.env.PUBLIC_RATE_LIMIT_MAX = '10000';
    process.env.AVAILABILITY_RATE_LIMIT_MAX = '10000';
    process.env.PROFILE_RATE_LIMIT_MAX = '10000';
    process.env.STORAGE_DIR = mkdtempSync(join(tmpdir(), 'fd-profiles-'));
    db = await setupTestDatabase();
    prisma = db.prisma;
    ctx = await baseData(prisma);
    ({ hashPassword } = await import('../../../apps/api/src/utils/password.js'));
    ({ syncAllDoctorSlots } = await import('../../../apps/api/src/modules/availability/availability.service.js'));
    const { createApp } = await import('../../../apps/api/src/app.js');
    server = createApp({ authRateLimit: { limit: 10_000 } }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((r) => (server ? server.close(r) : r()));
    await db?.teardown();
    rmSync(process.env.STORAGE_DIR, { recursive: true, force: true });
  });

  /* ------------------------------------------------------------ helpers */
  async function api(method, path, { body, raw, token, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'x-fogaan-client': 'native', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    let json = null;
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      json = null;
    }
    return { status: res.status, body: json, buf, headers: res.headers };
  }
  const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;
  const login = (email, role, password = PASSWORD) => api('POST', '/api/v1/auth/login', { body: { email, password, ...(role ? { role } : {}) } });

  async function patientAccount(extra = {}) {
    const email = `p-${uniq()}@example.test`;
    const user = await prisma.user.create({
      data: { email, phone: extra.phone ?? null, fullName: `Patient ${uniq()}`, passwordHash: await hashPassword(PASSWORD), roles: { create: [{ roleId: ctx.roles.PATIENT.id }] }, patientProfile: { create: {} } },
      include: { patientProfile: true },
    });
    const session = (await login(email, 'PATIENT')).body.data;
    return { user, patient: user.patientProfile, email, token: session.accessToken, refreshToken: session.refreshToken };
  }

  /** A doctor approved through the real workflow (register → apply → upload → submit → admin approves) + availability. */
  async function approvedDoctor() {
    const admEmail = `admin-${uniq()}@fogaandawo.test`;
    await prisma.user.create({ data: { email: admEmail, fullName: 'Admin', passwordHash: await hashPassword(PASSWORD), roles: { create: [{ roleId: ctx.roles.ADMIN.id }] } } });
    const admToken = (await login(admEmail, 'ADMIN')).body.data.accessToken;
    const email = `doc-${uniq()}@example.test`;
    const reg = await api('POST', '/api/v1/auth/register', { body: { fullName: 'Dr. Profile', email, password: PASSWORD, passwordConfirmation: PASSWORD } });
    const pt = reg.body.data.accessToken;
    const userId = reg.body.data.user.id;
    await api('PUT', '/api/v1/doctor-application', {
      token: pt,
      body: { professionalName: `Dr. Profile ${uniq()}`, specialtyId: ctx.specialty.id, licenceNumber: `SMC-${uniq()}`, licenceCountry: 'Somalia', consultationFee: 20, bio: BIO, languages: ['so'] },
    });
    await api('POST', '/api/v1/doctor-application/documents/MEDICAL_LICENSE', { token: pt, raw: PDF, headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'licence.pdf' } });
    await api('POST', '/api/v1/doctor-application/submit', { token: pt, body: {} });
    const doctor = await prisma.doctorProfile.findUniqueOrThrow({ where: { userId } });
    assert.equal((await api('POST', `/api/v1/admin/doctor-applications/${doctor.id}/approve`, { token: admToken, body: {} })).status, 200);
    const token = (await login(email, 'DOCTOR')).body.data.accessToken;
    assert.equal((await api('PUT', '/api/v1/doctors/me/availability/schedule', { token, body: SCHEDULE })).status, 200);
    return { email, userId, doctor, doctorId: doctor.id, token, admToken };
  }

  const jpeg = (w = 640, h = 480) =>
    sharp({ create: { width: w, height: h, channels: 3, background: '#0f766e' } })
      .jpeg()
      .withExifMerge({ IFD0: { Make: 'PhoneCam', Model: 'Model-9' }, IFD3: { GPSLatitudeRef: 'N' } })
      .toBuffer();
  const putPhoto = (token, raw) => api('PUT', '/api/v1/me/photo', { token, raw, headers: { 'content-type': 'application/octet-stream' } });
  const openSlots = (doctorId) => prisma.availabilitySlot.count({ where: { doctorId, status: 'AVAILABLE', startAtUtc: { gt: new Date() } } });

  /* ------------------------------------------------------------ patient profile */

  test('patient views and updates their own profile; read-only and admin fields cannot be changed', async () => {
    const p = await patientAccount({ phone: `+25261${String(Date.now()).slice(-7)}` });
    const view = await api('GET', '/api/v1/me/profile', { token: p.token });
    assert.equal(view.status, 200, JSON.stringify(view.body));
    assert.equal(view.body.data.email, p.email);
    assert.equal(view.body.data.account.status, 'ACTIVE');
    assert.deepEqual(view.body.data.account.roles, ['PATIENT']);
    assert.equal(view.body.data.account.signInMethods.password.enabled, true);
    assert.equal(view.body.data.completeness.requiredDone, true);

    const upd = await api('PATCH', '/api/v1/me/profile', {
      token: p.token,
      body: {
        fullName: 'Amina Warsame',
        preferredLanguage: 'so',
        dateOfBirth: '1992-03-15',
        sex: 'FEMALE',
        address: { city: 'Hargeisa', addressLine: 'Jigjiga Yar' },
        emergencyContact: { name: 'Hodan Warsame', relationship: 'Sister', phone: '+252634445566' },
      },
    });
    assert.equal(upd.status, 200, JSON.stringify(upd.body));
    const d = upd.body.data;
    assert.equal(d.fullName, 'Amina Warsame');
    assert.equal(d.preferredLanguage, 'so');
    assert.equal(d.dateOfBirth, '1992-03-15');
    assert.deepEqual(d.address, { city: 'Hargeisa', addressLine: 'Jigjiga Yar' });
    assert.deepEqual(d.emergencyContact, { name: 'Hodan Warsame', relationship: 'Sister', phone: '+252634445566' });
    assert.ok(d.completeness.percent > view.body.data.completeness.percent);

    for (const body of [{ email: 'new@example.test' }, { phone: '+252611111111' }, { role: 'ADMIN' }, { status: 'ACTIVE' }, { roles: ['ADMIN'] }, { fullName: 'X Y', verificationStatus: 'VERIFIED' }]) {
      const r = await api('PATCH', '/api/v1/me/profile', { token: p.token, body });
      assert.equal(r.status, 400, `rejected: ${JSON.stringify(body)}`);
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: p.user.id }, include: { roles: true } });
    assert.equal(user.email, p.email, 'email unchanged');
    assert.equal(user.roles.length, 1, 'roles unchanged');

    // Clearing optional data works (address row removed, emergency contact nulled).
    const cleared = await api('PATCH', '/api/v1/me/profile', { token: p.token, body: { address: null, emergencyContact: null, dateOfBirth: null } });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.data.address, null);
    assert.equal(cleared.body.data.emergencyContact, null);

    // Audit records field names only — never the personal values.
    const audits = await prisma.auditLog.findMany({ where: { entityType: 'PatientProfile', entityId: p.patient.id } });
    assert.ok(audits.length >= 2);
    const text = JSON.stringify(audits.map((a) => a.newValues));
    for (const secret of ['Hargeisa', 'Hodan', '+252634445566', '1992-03-15']) assert.ok(!text.includes(secret), `audit must not contain ${secret}`);
  });

  test('a patient cannot read or change another patient\'s profile or history; other roles are refused', async () => {
    const a = await patientAccount();
    const b = await patientAccount();
    const bEntry = await api('POST', '/api/v1/me/medical-history', { token: b.token, body: { entryType: 'ALLERGY', title: 'Peanuts' } });
    assert.equal(bEntry.status, 201);
    // No endpoint takes a patient id; addressing B's entry through A's own endpoints is a 404.
    assert.equal((await api('PATCH', `/api/v1/me/medical-history/entries/${bEntry.body.data.id}`, { token: a.token, body: { title: 'Changed' } })).status, 404);
    assert.equal((await api('POST', `/api/v1/me/medical-history/entries/${bEntry.body.data.id}/archive`, { token: a.token, body: {} })).status, 404);
    const aList = await api('GET', '/api/v1/me/medical-history', { token: a.token });
    assert.equal(aList.body.data.entries.length, 0, 'A sees none of B\'s entries');
    assert.equal((await prisma.medicalHistoryEntry.findUniqueOrThrow({ where: { id: bEntry.body.data.id } })).title, 'Peanuts');

    assert.equal((await api('GET', '/api/v1/me/profile')).status, 401, 'authentication required');
    assert.equal((await api('GET', '/api/v1/me/medical-history')).status, 401);
    const d = await approvedDoctor();
    assert.equal((await api('GET', '/api/v1/me/profile', { token: d.token })).status, 403, 'doctor role cannot use the patient profile API');
    assert.equal((await api('GET', '/api/v1/me/medical-history', { token: d.token })).status, 403);
  });

  test('a submitted/verified doctor cannot rename themselves through the patient profile', async () => {
    const d = await approvedDoctor();
    const pt = (await login(d.email, 'PATIENT')).body.data.accessToken;
    const r = await api('PATCH', '/api/v1/me/profile', { token: pt, body: { fullName: 'Someone Else' } });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'NAME_LOCKED_BY_DOCTOR_PROFILE');
    assert.equal((await api('PATCH', '/api/v1/me/profile', { token: pt, body: { sex: 'MALE' } })).status, 200, 'other fields still editable');
  });

  /* ------------------------------------------------------------ medical history */

  test('patient manages longitudinal history; doctor-written entries are read-only to them but archivable; nothing is deleted', async () => {
    const p = await patientAccount();
    const add = await api('POST', '/api/v1/me/medical-history', { token: p.token, body: { entryType: 'ALLERGY', title: 'Penicillin', description: 'Hives', recordedAt: '2019-06-01' } });
    assert.equal(add.status, 201, JSON.stringify(add.body));
    assert.equal(add.body.data.source, 'PATIENT');
    assert.equal(add.body.data.canEdit, true);
    const edit = await api('PATCH', `/api/v1/me/medical-history/entries/${add.body.data.id}`, { token: p.token, body: { description: 'Hives and swelling' } });
    assert.equal(edit.status, 200);
    assert.equal(edit.body.data.description, 'Hives and swelling');
    assert.equal((await api('POST', '/api/v1/me/medical-history', { token: p.token, body: { entryType: 'ALLERGY', title: 'X', source: 'DOCTOR' } })).status, 400, 'source cannot be forged');

    // A doctor who consulted the patient writes an entry through the existing service.
    const d = await approvedDoctor();
    await createCompletedConsultation(prisma, { patient: p.patient, doctor: d.doctor });
    const history = await import('../../../apps/api/src/modules/medical-history/medicalHistory.service.js');
    const byDoctor = await history.addEntry({ actorUserId: d.userId, patientId: p.patient.id, entryType: 'CONDITION', title: 'Type 2 diabetes' });

    const list = await api('GET', '/api/v1/me/medical-history', { token: p.token });
    const docEntry = list.body.data.entries.find((e) => e.id === byDoctor.id);
    assert.equal(docEntry.source, 'DOCTOR');
    assert.ok(docEntry.authorName?.startsWith('Dr. Profile'));
    assert.equal(docEntry.canEdit, false);
    assert.equal(docEntry.canArchive, true);

    const denied = await api('PATCH', `/api/v1/me/medical-history/entries/${byDoctor.id}`, { token: p.token, body: { title: 'Pre-diabetes' } });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, 'HISTORY_DOCTOR_ENTRY_READ_ONLY');

    // Doctor cannot overwrite the patient's own entry (service-level; the doctor role has no route to it at all).
    await assert.rejects(history.updateEntry({ actorUserId: d.userId, entryId: add.body.data.id, changes: { title: 'Changed by doctor' } }), (e) => e.status === 403);
    await assert.rejects(history.archiveEntry({ actorUserId: d.userId, entryId: add.body.data.id }), (e) => e.status === 403);
    assert.equal((await prisma.medicalHistoryEntry.findUniqueOrThrow({ where: { id: add.body.data.id } })).title, 'Penicillin');

    const archived = await api('POST', `/api/v1/me/medical-history/entries/${byDoctor.id}/archive`, { token: p.token, body: {} });
    assert.equal(archived.status, 200);
    assert.ok(archived.body.data.archivedAt);
    const again = await api('PATCH', `/api/v1/me/medical-history/entries/${byDoctor.id}`, { token: p.token, body: { title: 'x y' } });
    assert.equal(again.status, 409, 'archived entries are frozen');
    assert.equal((await api('GET', '/api/v1/me/medical-history', { token: p.token })).body.data.entries.some((e) => e.id === byDoctor.id), false, 'hidden by default');
    assert.equal((await api('GET', '/api/v1/me/medical-history?includeArchived=true', { token: p.token })).body.data.entries.some((e) => e.id === byDoctor.id), true);

    // Database triggers: no deletes, authorship and archive are immutable.
    await assert.rejects(prisma.medicalHistoryEntry.delete({ where: { id: add.body.data.id } }), /cannot be deleted/);
    await assert.rejects(prisma.medicalHistoryEntry.update({ where: { id: byDoctor.id }, data: { archivedAt: null } }), /archived/);
    await assert.rejects(prisma.medicalHistoryEntry.update({ where: { id: add.body.data.id }, data: { createdByUserId: d.userId } }), /authorship/);
    await assert.rejects(prisma.medicalHistoryEntry.update({ where: { id: add.body.data.id }, data: { source: 'DOCTOR' } }), /authorship/);

    // Audit: field names only, never the medical text.
    const audits = await prisma.auditLog.findMany({ where: { entityType: 'MedicalHistoryEntry', entityId: { in: [add.body.data.id, byDoctor.id] } } });
    assert.ok(audits.length >= 4);
    const text = JSON.stringify(audits.map((a) => [a.oldValues, a.newValues]));
    for (const secret of ['Penicillin', 'Hives', 'diabetes']) assert.ok(!text.includes(secret), `audit must not contain ${secret}`);

    // Consultation notes remain separate: the history API never returns them.
    assert.ok(!JSON.stringify(list.body).includes('assessment'));
  });

  /* ------------------------------------------------------------ doctor profile */

  test('doctor edits permitted professional information; fee applies to new bookings only; verification fields are refused', async () => {
    const d = await approvedDoctor();
    const p = await patientAccount();
    const { appointment } = await createCompletedConsultation(prisma, { patient: p.patient, doctor: d.doctor });
    const view = await api('GET', '/api/v1/doctors/me/profile', { token: d.token });
    assert.equal(view.status, 200, JSON.stringify(view.body));
    assert.equal(view.body.data.verification.status, 'VERIFIED');
    assert.equal(view.body.data.listedPublicly, true);
    assert.equal(view.body.data.nameLocked, true);

    const upd = await api('PATCH', '/api/v1/doctors/me/profile', { token: d.token, body: { bio: `${BIO} Updated.`, qualifications: 'MBBS, MSc Public Health', yearsExperience: 11, consultationFee: 30, languages: ['so', 'en', 'ar'] } });
    assert.equal(upd.status, 200, JSON.stringify(upd.body));
    assert.equal(upd.body.data.consultationFee, '30.00');
    assert.equal(upd.body.data.qualifications, 'MBBS, MSc Public Health');
    assert.deepEqual([...upd.body.data.languages].sort(), ['ar', 'en', 'so']);
    assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).feeAmount.toFixed(2), '20.00', 'existing appointment keeps its fee');
    const feeAudit = await prisma.auditLog.findFirst({ where: { entityType: 'DoctorProfile', entityId: d.doctorId }, orderBy: { createdAt: 'desc' } });
    assert.equal(feeAudit.oldValues.consultationFee, '20.00');
    assert.equal(feeAudit.newValues.consultationFee, '30.00');

    for (const body of [{ verificationStatus: 'VERIFIED' }, { verifiedAt: new Date().toISOString() }, { accountStatus: 'ACTIVE' }, { licenceNumber: 'NEW-1' }, { licenceCountry: 'Kenya' }, { specialtyId: ctx.specialty.id }, { professionalName: 'Dr X' }]) {
      assert.equal((await api('PATCH', '/api/v1/doctors/me/profile', { token: d.token, body })).status, 400, JSON.stringify(body));
    }
    const fresh = await prisma.doctorProfile.findUniqueOrThrow({ where: { id: d.doctorId } });
    assert.equal(fresh.verificationStatus, 'VERIFIED');
    assert.equal(fresh.licenceNumber, d.doctor.licenceNumber);

    // A patient (including a pending applicant) has no access to the doctor profile API.
    assert.equal((await api('GET', '/api/v1/doctors/me/profile', { token: p.token })).status, 403);
    assert.equal((await api('PATCH', '/api/v1/doctors/me/profile', { token: p.token, body: { bio: BIO } })).status, 403);
  });

  test('public profile shows approved information only; private data never leaks; unlisted doctors are hidden', async () => {
    const d = await approvedDoctor();
    await api('PATCH', '/api/v1/doctors/me/profile', { token: d.token, body: { qualifications: 'MBBS (Amoud University)' } });
    assert.equal((await putPhoto(d.token, await jpeg())).status, 200);
    const pub = await api('GET', `/api/v1/doctors/${d.doctorId}`);
    assert.equal(pub.status, 200);
    const doc = pub.body.data;
    assert.equal(doc.verified, true);
    assert.equal(doc.qualifications, 'MBBS (Amoud University)');
    assert.ok(doc.photoUrl?.startsWith(`/v1/doctors/${d.doctorId}/photo?v=`), 'relative to the API base');
    const text = JSON.stringify(pub.body);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: d.userId } });
    for (const secret of [d.email, d.doctor.licenceNumber, row.avatarKey, 'avatars/', 'doctor-documents/', 'licenceNumber', 'email', 'phone', 'passwordHash', 'notes', 'reviewer']) {
      assert.ok(!text.includes(secret), `public profile must not contain ${secret}`);
    }
    const search = await api('GET', '/api/v1/doctors?pageSize=50');
    assert.ok(!JSON.stringify(search.body).includes(d.email));

    const photo = await api('GET', `/api${doc.photoUrl}`);
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get('content-type'), 'image/jpeg');
    assert.equal(photo.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await sharp(photo.buf).metadata()).exif, undefined, 'served photo has no EXIF');

    // Pending / suspended doctors: no public profile, no public photo.
    await prisma.doctorProfile.update({ where: { id: d.doctorId }, data: { accountStatus: 'SUSPENDED' } });
    assert.equal((await api('GET', `/api/v1/doctors/${d.doctorId}`)).status, 404);
    assert.equal((await api('GET', `/api/v1/doctors/${d.doctorId}/photo`)).status, 404);
    await prisma.doctorProfile.update({ where: { id: d.doctorId }, data: { accountStatus: 'ACTIVE' } });
  });

  /* ------------------------------------------------------------ licence replacement + availability */

  test('critical licence replacement from the profile triggers Option A; withdrawn availability is never restored automatically', async () => {
    const d = await approvedDoctor();
    assert.ok((await openSlots(d.doctorId)) > 0);
    const noConfirm = await api('POST', `/api/v1/doctors/me/licence?licenceNumber=SMC-NEW-1&licenceCountry=Somalia`, { token: d.token, raw: PDF, headers: { 'content-type': 'application/octet-stream' } });
    assert.equal(noConfirm.status, 400, 'explicit confirmation required');
    const notAFile = await api('POST', `/api/v1/doctors/me/licence?licenceNumber=SMC-NEW-1&licenceCountry=Somalia&confirm=true`, { token: d.token, raw: Buffer.from('MZ executable'.padEnd(64, '!')), headers: { 'content-type': 'application/pdf' } });
    assert.equal(notAFile.status, 415, 'type from bytes, not the header');

    const r = await api('POST', `/api/v1/doctors/me/licence?licenceNumber=SMC-NEW-1&licenceCountry=Somalia&confirm=true`, { token: d.token, raw: PDF, headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'new-licence.pdf' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.reverificationRequired, true);
    assert.equal(r.body.data.doctorRoleRemoved, true);
    const profile = await prisma.doctorProfile.findUniqueOrThrow({ where: { id: d.doctorId } });
    assert.equal(profile.verificationStatus, 'PENDING');
    assert.equal(profile.licenceNumber, 'SMC-NEW-1');
    assert.equal(await openSlots(d.doctorId), 0, 'slots withdrawn');
    assert.equal(await prisma.availabilityRule.count({ where: { doctorId: d.doctorId, isActive: true } }), 0, 'weekly rules deactivated');
    assert.equal((await api('GET', `/api/v1/doctors/${d.doctorId}`)).status, 404, 'hidden publicly');
    const pendingRequest = await prisma.verificationRequest.findFirstOrThrow({ where: { doctorId: d.doctorId, status: 'PENDING' } });
    assert.ok(await prisma.notification.findFirst({ where: { eventKey: `application.submitted:${pendingRequest.id}` } }), 'admins notified');

    // Pending: the old doctor session and a new doctor login cannot edit the profile or publish availability.
    assert.equal((await api('PATCH', '/api/v1/doctors/me/profile', { token: d.token, body: { bio: BIO } })).status, 403);
    assert.equal((await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: d.token, body: SCHEDULE })).status, 403);
    assert.notEqual((await login(d.email, 'DOCTOR')).status, 200);

    // Re-approval restores the role but NOT the availability, even after the daily slot sync runs.
    assert.equal((await api('POST', `/api/v1/admin/doctor-applications/${d.doctorId}/approve`, { token: d.admToken, body: {} })).status, 200);
    await syncAllDoctorSlots();
    assert.equal(await openSlots(d.doctorId), 0, 'no automatic restoration');
    const dt = (await login(d.email, 'DOCTOR')).body.data.accessToken;
    assert.equal((await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: dt, body: SCHEDULE })).status, 200);
    assert.ok((await openSlots(d.doctorId)) > 0, 'doctor publishes new availability');
  });

  test('suspended doctors cannot publish availability or edit their profile', async () => {
    const d = await approvedDoctor();
    await prisma.doctorProfile.update({ where: { id: d.doctorId }, data: { accountStatus: 'SUSPENDED' } });
    assert.equal((await api('PUT', '/api/v1/doctors/me/availability/schedule', { token: d.token, body: SCHEDULE })).status, 403);
    assert.notEqual((await api('PATCH', '/api/v1/doctors/me/profile', { token: d.token, body: { bio: BIO } })).status, 200);
  });

  /* ------------------------------------------------------------ photos */

  test('profile photo: upload strips EXIF, replace removes the old file, patient photos are private, remove works', async () => {
    const p = await patientAccount();
    const up = await putPhoto(p.token, await jpeg());
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.equal(up.body.data.hasPhoto, true);
    assert.ok(!JSON.stringify(up.body).includes('avatars/'), 'storage key never returned');
    const mine = await api('GET', '/api/v1/me/photo', { token: p.token });
    assert.equal(mine.status, 200);
    assert.equal(mine.headers.get('cache-control'), 'private, no-store');
    const meta = await sharp(mine.buf).metadata();
    assert.equal(meta.exif, undefined);
    assert.equal(meta.width, 512);
    assert.ok(!mine.buf.includes(Buffer.from('PhoneCam')));

    const dir = join(process.env.STORAGE_DIR, 'avatars', p.user.id);
    assert.equal(readdirSync(dir).length, 1);
    assert.equal((await putPhoto(p.token, await jpeg(900, 900))).status, 200, 'replace');
    assert.equal(readdirSync(dir).length, 1, 'previous file removed after replace');

    assert.equal((await putPhoto(p.token, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).status, 415);
    assert.equal((await putPhoto(p.token, Buffer.alloc(0))).status, 400);
    assert.equal((await api('GET', '/api/v1/me/photo')).status, 401, 'no anonymous access');
    const other = await patientAccount();
    assert.equal((await api('GET', '/api/v1/me/photo', { token: other.token })).status, 404, 'another user only ever gets their own (none)');
    // Patient photos have no public URL: the public doctor photo route only serves listed doctors.
    assert.equal((await api('GET', `/api/v1/doctors/${p.patient.id}/photo`)).status, 404);

    const removed = await api('DELETE', '/api/v1/me/photo', { token: p.token });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.data.hasPhoto, false);
    assert.equal(readdirSync(dir).length, 0, 'file removed');
    assert.equal((await api('GET', '/api/v1/me/photo', { token: p.token })).status, 404);
    assert.ok(existsSync(process.env.STORAGE_DIR));
  });

  /* ------------------------------------------------------------ assigned doctor: read-only patient information */

  async function doctorAccount(name = `Dr. Reader ${uniq()}`) {
    const email = `dr-${uniq()}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        fullName: name,
        passwordHash: await hashPassword(PASSWORD),
        roles: { create: [{ roleId: ctx.roles.DOCTOR.id }] },
        doctorProfile: { create: { specialtyId: ctx.specialty.id, licenceNumber: `L-${uniq()}`, licenceCountry: 'Somalia', consultationFee: '20.00', verificationStatus: 'VERIFIED', verifiedAt: new Date() } },
      },
      include: { doctorProfile: true },
    });
    return { user, doctor: user.doctorProfile, email, token: (await login(email, 'DOCTOR')).body.data.accessToken };
  }
  let apptCursor = 0;
  async function appointmentWith(patient, doctor, status) {
    apptCursor += 1;
    const startAtUtc = new Date(Date.now() + (apptCursor + 100) * 3_600_000);
    const slot = await prisma.availabilitySlot.create({ data: { doctorId: doctor.id, startAtUtc, endAtUtc: new Date(startAtUtc.getTime() + 30 * 60_000), timeZoneSnapshot: 'Africa/Mogadishu', status: 'BOOKED' } });
    return prisma.appointment.create({ data: { patientId: patient.id, doctorId: doctor.id, slotId: slot.id, status, feeAmount: '20.00', commissionRateSnapshot: '0.1500', startAtUtc, endAtUtc: slot.endAtUtc } });
  }
  const readAs = (token, patientId, appointmentId) =>
    api('GET', `/api/v1/doctors/me/patients/${patientId}/medical-history${appointmentId ? `?appointmentId=${appointmentId}` : ''}`, token ? { token } : {});
  const accessAudits = (patientId) => prisma.auditLog.findMany({ where: { entityType: 'PatientMedicalHistoryAccess', entityId: patientId }, orderBy: { createdAt: 'asc' } });

  test('assigned doctor reads the history read-only; summary is restricted; every read is audited without content', async () => {
    const p = await patientAccount({ phone: `+25261${String(Date.now()).slice(-7)}` });
    await api('PATCH', '/api/v1/me/profile', { token: p.token, body: { dateOfBirth: '1990-01-15', sex: 'FEMALE', address: { city: 'Hargeisa', addressLine: 'Jigjiga Yar' }, emergencyContact: { name: 'Hodan Contact', relationship: 'Sister', phone: '+252634445566' } } });
    await putPhoto(p.token, await jpeg());
    const own = await api('POST', '/api/v1/me/medical-history', { token: p.token, body: { entryType: 'ALLERGY', title: 'Penicillin', description: 'Severe rash' } });
    await api('POST', '/api/v1/me/medical-history', { token: p.token, body: { entryType: 'MEDICATION', title: 'Metformin 500 mg' } });
    const d = await doctorAccount();
    const appt = await appointmentWith(p.patient, d.doctor, 'CONFIRMED');

    const r = await readAs(d.token, p.patient.id, appt.id);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    const { patient, entries, appointment } = r.body.data;
    assert.equal(appointment.activeConsultation, false);
    assert.deepEqual(Object.keys(patient).sort(), ['age', 'emergencyContact', 'id', 'name', 'photoUrl', 'sex']);
    assert.ok(patient.photoUrl.startsWith(`/v1/doctors/me/patients/${p.patient.id}/photo?appointmentId=${appt.id}&v=`), 'gated doctor photo route');
    assert.ok(patient.age >= 35 && patient.sex === 'FEMALE');
    assert.equal(patient.emergencyContact, null, 'emergency contact hidden outside an active consultation');
    assert.deepEqual(entries.map((e) => e.title).sort(), ['Metformin 500 mg', 'Penicillin']);
    assert.ok(entries.every((e) => e.canEdit === false && e.canArchive === false), 'patient-written entries are read-only for the doctor');
    const text = JSON.stringify(r.body);
    for (const secret of [p.email, 'Hargeisa', 'Jigjiga', 'Hodan Contact', '+252634445566', 'avatars/', '"address', '"email', '"phone"']) {
      assert.ok(!text.includes(secret), `must not contain ${secret}`);
    }

    const audits = await accessAudits(p.patient.id);
    assert.equal(audits.length, 1, 'one audited history read (the photo is fetched below)');
    assert.equal(audits[0].actorUserId, d.user.id);
    assert.equal(audits[0].action, 'OTHER');
    const v = audits[0].newValues;
    assert.deepEqual({ action: v.action, doctorId: v.doctorId, patientId: v.patientId, appointmentId: v.appointmentId }, { action: 'VIEW_MEDICAL_HISTORY', doctorId: d.doctor.id, patientId: p.patient.id, appointmentId: appt.id });
    assert.ok(audits[0].createdAt instanceof Date);
    const auditText = JSON.stringify(audits);
    for (const secret of ['Penicillin', 'Severe rash', 'Metformin', 'Hodan']) assert.ok(!auditText.includes(secret), `audit must not contain ${secret}`);

    // The assigned doctor sees the patient's photo through the gated route (no EXIF, never cached, audited).
    const photo = await api('GET', `/api${patient.photoUrl}`, { token: d.token });
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get('content-type'), 'image/jpeg');
    assert.equal(photo.headers.get('cache-control'), 'private, no-store');
    assert.equal((await sharp(photo.buf).metadata()).exif, undefined);
    const photoAudit = (await accessAudits(p.patient.id)).find((a) => a.newValues.action === 'VIEW_PATIENT_PHOTO');
    assert.ok(photoAudit && photoAudit.newValues.appointmentId === appt.id && photoAudit.actorUserId === d.user.id, 'photo view audited');
    const stranger = await doctorAccount();
    assert.equal((await api('GET', `/api${patient.photoUrl}`, { token: stranger.token })).status, 403, 'unassigned doctor cannot see the photo');
    assert.equal((await api('GET', `/api/v1/doctors/me/patients/${p.patient.id}/photo`, { token: d.token })).status, 400, 'appointmentId required for the photo too');
    assert.equal((await api('GET', `/api/v1/doctors/${p.patient.id}/photo`)).status, 404, 'still no public URL for patient photos');

    // Doctor cannot edit or archive the patient's entry (service rules); the patient still can.
    const history = await import('../../../apps/api/src/modules/medical-history/medicalHistory.service.js');
    // Refused: 403 once the doctor has consulted the patient, 404 (no existence leak) before that.
    await assert.rejects(history.updateEntry({ actorUserId: d.user.id, entryId: own.body.data.id, changes: { title: 'Changed' } }), (e) => e.status === 403 || e.status === 404);
    await assert.rejects(history.archiveEntry({ actorUserId: d.user.id, entryId: own.body.data.id }), (e) => e.status === 403 || e.status === 404);
    const patientEdit = await api('PATCH', `/api/v1/me/medical-history/entries/${own.body.data.id}`, { token: p.token, body: { description: 'Severe rash and swelling' } });
    assert.equal(patientEdit.status, 200, 'patient still edits own entry');
  });

  test('emergency contact appears only during an active consultation; COMPLETED and WAITING are readable', async () => {
    const p = await patientAccount();
    await api('PATCH', '/api/v1/me/profile', { token: p.token, body: { emergencyContact: { name: 'Faisal Contact', relationship: 'Brother', phone: '+252615556677' } } });
    const d = await doctorAccount();
    const live = await appointmentWith(p.patient, d.doctor, 'IN_PROGRESS');
    const r = await readAs(d.token, p.patient.id, live.id);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.appointment.activeConsultation, true);
    assert.deepEqual(r.body.data.patient.emergencyContact, { name: 'Faisal Contact', relationship: 'Brother', phone: '+252615556677' });
    const audit = (await accessAudits(p.patient.id)).at(-1);
    assert.equal(audit.newValues.emergencyContactShown, true);
    assert.ok(!JSON.stringify(audit).includes('Faisal'), 'audit never stores the contact');
    for (const status of ['COMPLETED', 'WAITING']) {
      const a = await appointmentWith(p.patient, d.doctor, status);
      const res = await readAs(d.token, p.patient.id, a.id);
      assert.equal(res.status, 200, status);
      assert.equal(res.body.data.patient.emergencyContact, null, `${status}: not an active consultation`);
    }
  });

  test('doctor edits only entries they authored; doctor entries are editable only by their author', async () => {
    const p = await patientAccount();
    const d = await doctorAccount();
    const other = await doctorAccount();
    await createCompletedConsultation(prisma, { patient: p.patient, doctor: d.doctor });
    await createCompletedConsultation(prisma, { patient: p.patient, doctor: other.doctor });
    const history = await import('../../../apps/api/src/modules/medical-history/medicalHistory.service.js');
    const mine = await history.addEntry({ actorUserId: d.user.id, patientId: p.patient.id, entryType: 'CONDITION', title: 'Hypertension' });
    const theirs = await history.addEntry({ actorUserId: other.user.id, patientId: p.patient.id, entryType: 'CONDITION', title: 'Asthma' });
    assert.equal((await history.updateEntry({ actorUserId: d.user.id, entryId: mine.id, changes: { description: 'Stage 1' } })).description, 'Stage 1');
    await assert.rejects(history.updateEntry({ actorUserId: d.user.id, entryId: theirs.id, changes: { title: 'Changed' } }), (e) => e.status === 403);
    const appt = await appointmentWith(p.patient, d.doctor, 'COMPLETED');
    const r = await readAs(d.token, p.patient.id, appt.id);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const byTitle = Object.fromEntries(r.body.data.entries.map((e) => [e.title, e]));
    assert.equal(byTitle.Hypertension.canEdit, true, 'own entry editable');
    assert.equal(byTitle.Asthma.canEdit, false, "another doctor's entry is read-only");
  });

  test('access requires an eligible appointment of THIS doctor with THIS patient; denials leak nothing and are not audited', async () => {
    const p = await patientAccount();
    const q = await patientAccount();
    await api('POST', '/api/v1/me/medical-history', { token: p.token, body: { entryType: 'ALLERGY', title: 'Latex' } });
    const assigned = await doctorAccount();
    const unrelated = await doctorAccount();
    const appt = await appointmentWith(p.patient, assigned.doctor, 'CONFIRMED');
    const unrelatedOwn = await appointmentWith(q.patient, unrelated.doctor, 'CONFIRMED');

    const denied = async (res, label) => {
      assert.equal(res.status, 403, `${label}: ${JSON.stringify(res.body)}`);
      assert.ok(!JSON.stringify(res.body).includes('Latex'), `${label}: no data`);
    };
    await denied(await readAs(unrelated.token, p.patient.id, appt.id), 'unassigned doctor with another doctor\'s appointment id');
    await denied(await readAs(unrelated.token, p.patient.id, unrelatedOwn.id), 'another doctor using their own appointment');
    await denied(await readAs(assigned.token, q.patient.id, appt.id), 'assigned doctor asking about a different patient');
    assert.equal((await readAs(assigned.token, p.patient.id)).status, 400, 'a patient id alone is never enough (appointmentId required)');
    for (const status of ['PENDING_PAYMENT', 'CANCELLED', 'EXPIRED', 'NO_SHOW', 'RESCHEDULED']) {
      const a = await appointmentWith(p.patient, assigned.doctor, status);
      await denied(await readAs(assigned.token, p.patient.id, a.id), status);
    }
    assert.equal((await readAs(p.token, p.patient.id, appt.id)).status, 403, 'patient role refused');
    assert.equal((await readAs(null, p.patient.id, appt.id)).status, 401, 'unauthenticated refused');

    await prisma.doctorProfile.update({ where: { id: assigned.doctor.id }, data: { accountStatus: 'SUSPENDED' } });
    await denied(await readAs(assigned.token, p.patient.id, appt.id), 'suspended doctor');
    await prisma.doctorProfile.update({ where: { id: assigned.doctor.id }, data: { accountStatus: 'ACTIVE' } });
    assert.equal((await readAs(assigned.token, p.patient.id, appt.id)).status, 200, 'reactivated doctor can read again');

    assert.equal((await accessAudits(p.patient.id)).length, 1, 'only the one successful read is audited');
    assert.equal((await accessAudits(q.patient.id)).length, 0);
  });

  test("the assigned doctor's appointment view carries the patient id for the panel (no contact data)", async () => {
    const p = await patientAccount();
    const d = await doctorAccount();
    const appt = await appointmentWith(p.patient, d.doctor, 'CONFIRMED');
    const asDoctor = await api('GET', `/api/v1/doctors/me/appointments/${appt.id}`, { token: d.token });
    assert.equal(asDoctor.status, 200, JSON.stringify(asDoctor.body));
    assert.equal(asDoctor.body.data.patient.id, p.patient.id);
    assert.equal(asDoctor.body.data.patient.photoUrl, null, 'no photo yet → initials');
    assert.ok(!JSON.stringify(asDoctor.body).includes(p.email), 'still no patient email');

    // With a photo: eligible appointments (upcoming and past lists, detail) carry the gated URL; others do not.
    await putPhoto(p.token, await jpeg());
    const cancelled = await appointmentWith(p.patient, d.doctor, 'CANCELLED');
    const completed = await appointmentWith(p.patient, d.doctor, 'COMPLETED');
    const detail = await api('GET', `/api/v1/doctors/me/appointments/${appt.id}`, { token: d.token });
    assert.ok(detail.body.data.patient.photoUrl.startsWith(`/v1/doctors/me/patients/${p.patient.id}/photo?appointmentId=${appt.id}&v=`));
    const upcoming = await api('GET', '/api/v1/doctors/me/appointments?scope=upcoming', { token: d.token });
    const past = await api('GET', '/api/v1/doctors/me/appointments?scope=past', { token: d.token });
    const all = [...(upcoming.body.data.items ?? upcoming.body.data), ...(past.body.data.items ?? past.body.data)];
    const byId = Object.fromEntries(all.map((i) => [i.id, i]));
    assert.ok(byId[appt.id]?.patient.photoUrl, 'upcoming card has the photo');
    if (byId[completed.id]) assert.ok(byId[completed.id].patient.photoUrl, 'past (completed) card has the photo');
    if (byId[cancelled.id]) assert.equal(byId[cancelled.id].patient.photoUrl, null, 'cancelled appointment: no photo');
    const photo = await api('GET', `/api${byId[appt.id].patient.photoUrl}`, { token: d.token });
    assert.equal(photo.status, 200);
    assert.equal((await api('GET', `/api/v1/doctors/me/patients/${p.patient.id}/photo?appointmentId=${cancelled.id}`, { token: d.token })).status, 403, 'cancelled appointment cannot unlock the photo');
    const asPatient = await api('GET', `/api/v1/appointments/${appt.id}`, { token: p.token });
    assert.ok(!JSON.stringify(asPatient.body).includes('/photo?appointmentId'), "the patient's own view has no doctor photo URLs");
  });

  /* ------------------------------------------------------------ account security */

  test('change password: requires the current password, revokes other sessions, keeps this one; Google-only accounts refused', async () => {
    const p = await patientAccount();
    const second = (await login(p.email, 'PATIENT')).body.data;
    const wrong = await api('POST', '/api/v1/auth/password', { token: p.token, body: { currentPassword: 'Wrong-pass-1', newPassword: 'Brand-new-77', newPasswordConfirmation: 'Brand-new-77' } });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error.code, 'CURRENT_PASSWORD_INVALID');
    assert.equal((await api('POST', '/api/v1/auth/password', { body: { currentPassword: PASSWORD, newPassword: 'Brand-new-77', newPasswordConfirmation: 'Brand-new-77' } })).status, 401);
    assert.equal((await api('POST', '/api/v1/auth/password', { token: p.token, body: { currentPassword: PASSWORD, newPassword: 'Brand-new-77', newPasswordConfirmation: 'Brand-new-77' }, headers: { 'x-fogaan-client': '' } })).status, 403, 'client header required');

    const ok = await api('POST', '/api/v1/auth/password', { token: p.token, body: { currentPassword: PASSWORD, newPassword: 'Brand-new-77', newPasswordConfirmation: 'Brand-new-77' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.body.data.otherSessionsRevoked >= 1);
    assert.equal((await api('GET', '/api/v1/auth/me', { token: p.token })).status, 200, 'current session stays signed in');
    assert.equal((await api('GET', '/api/v1/auth/me', { token: second.accessToken })).status, 401, 'other session revoked');
    assert.equal((await api('POST', '/api/v1/auth/refresh', { body: { refreshToken: second.refreshToken } })).status, 401, 'other refresh token dead');
    const rotated = await api('POST', '/api/v1/auth/refresh', { body: { refreshToken: p.refreshToken } });
    assert.equal(rotated.status, 200, 'current session refresh token still rotates');
    assert.equal((await login(p.email, 'PATIENT')).status, 401, 'old password no longer works');
    assert.equal((await login(p.email, 'PATIENT', 'Brand-new-77')).status, 200);
    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'UserPassword', entityId: p.user.id } });
    assert.ok(audit);
    assert.ok(!JSON.stringify(audit).includes('Brand-new-77'));

    // Google-only patient (no password): cannot set one here.
    const g = await prisma.user.create({ data: { email: `g-${uniq()}@gmail.test`, fullName: 'Google Only', roles: { create: [{ roleId: ctx.roles.PATIENT.id }] }, patientProfile: { create: {} } } });
    const { startSession } = await import('../../../apps/api/src/modules/auth/auth.service.js');
    const { signAccessToken } = await import('../../../apps/api/src/modules/auth/auth.tokens.js');
    const session = await prisma.$transaction((tx) => startSession(tx, { ...g, roles: [{ role: { name: 'PATIENT' } }] }, 'PATIENT', {}, new Date()));
    const { token: gToken } = await signAccessToken({ userId: g.id, sessionId: session.sessionId, role: 'PATIENT' });
    const gRes = await api('POST', '/api/v1/auth/password', { token: gToken, body: { currentPassword: 'anything', newPassword: 'Brand-new-77', newPasswordConfirmation: 'Brand-new-77' } });
    assert.equal(gRes.status, 409);
    assert.equal(gRes.body.error.code, 'PASSWORD_NOT_SET');
  });
});
