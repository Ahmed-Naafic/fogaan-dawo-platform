// Phase 10 — digital prescriptions, PDFs, QR verification, consultation summaries, medical documents and
// admin metadata monitoring. Real HTTP API + services against an isolated per-run schema on the development
// database branch (never production). Files go to a temporary private storage directory.
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';

const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';
const HOUR = 3_600_000;
const item = (name = 'Amoxicillin 500 mg') => ({ medicineName: name, dose: '1 capsule', frequency: '3 times daily', duration: '7 days', quantity: '21 capsules', instructions: 'After meals', warnings: 'Stop if a rash appears' });

describe('prescriptions & medical documents (development branch, isolated schema)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let server;
  let base;
  let hashPassword;
  let seq = 0;
  let admin;

  before(async () => {
    process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
    process.env.BCRYPT_ROUNDS = '10';
    process.env.COOKIE_SECURE = 'false';
    process.env.UPLOAD_RATE_LIMIT_MAX = '1000';
    process.env.PRESCRIPTION_RATE_LIMIT_MAX = '10000';
    process.env.PROFILE_RATE_LIMIT_MAX = '10000';
    process.env.CONSULTATION_RATE_LIMIT_MAX = '10000';
    process.env.VERIFY_RATE_LIMIT_MAX = '10000';
    process.env.WEB_APP_URL = 'https://app.fogaandawo.test';
    process.env.STORAGE_DIR = mkdtempSync(join(tmpdir(), 'fd-p10-'));
    db = await setupTestDatabase();
    prisma = db.prisma;
    ctx = await baseData(prisma);
    ({ hashPassword } = await import('../../../apps/api/src/utils/password.js'));
    const { createApp } = await import('../../../apps/api/src/app.js');
    server = createApp({ authRateLimit: { limit: 10_000 } }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
    admin = await account('ADMIN');
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
  const login = async (email, role) => (await api('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD, role } })).body?.data?.accessToken;

  async function account(role, { verificationStatus = 'VERIFIED', name } = {}) {
    const email = `p10-${role.toLowerCase()}-${uniq()}@example.test`;
    const user = await prisma.user.create({
      data: { email, fullName: name ?? `${role === 'DOCTOR' ? 'Dr. ' : ''}P10 ${uniq()}`, passwordHash: await hashPassword(PASSWORD), roles: { create: [{ roleId: ctx.roles[role].id }] } },
    });
    let profile = null;
    if (role === 'PATIENT') profile = await prisma.patientProfile.create({ data: { userId: user.id } });
    if (role === 'DOCTOR') {
      profile = await prisma.doctorProfile.create({
        data: { userId: user.id, specialtyId: ctx.specialty.id, licenceNumber: `L-${uniq()}`, licenceCountry: 'Somalia', consultationFee: '20.00', verificationStatus, verifiedAt: verificationStatus === 'VERIFIED' ? new Date() : null },
      });
    }
    return { user, profile, email, token: await login(email, role) };
  }

  let slotN = 0;
  /** A consultation between patient and doctor. status IN_PROGRESS, or COMPLETED `hoursAgo` hours ago. */
  async function consultation(patient, doctor, { status = 'IN_PROGRESS', hoursAgo = 1 } = {}) {
    slotN += 1;
    // Distinct, non-overlapping 30-minute slots per doctor (the database forbids overlapping slots).
    const startAtUtc = new Date(Date.now() - 30 * 24 * HOUR - slotN * HOUR); // own hour per slot; completion time set below
    const slot = await prisma.availabilitySlot.create({ data: { doctorId: doctor.profile.id, startAtUtc, endAtUtc: new Date(startAtUtc.getTime() + 30 * 60_000), timeZoneSnapshot: 'Africa/Mogadishu', status: 'BOOKED' } });
    const appointment = await prisma.appointment.create({
      data: { patientId: patient.profile.id, doctorId: doctor.profile.id, slotId: slot.id, status: status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS', feeAmount: '20.00', commissionRateSnapshot: '0.1500', startAtUtc, endAtUtc: slot.endAtUtc },
    });
    const completedAt = status === 'COMPLETED' ? new Date(Date.now() - hoursAgo * HOUR) : null;
    const c = await prisma.consultation.create({
      data: { appointmentId: appointment.id, patientId: patient.profile.id, doctorId: doctor.profile.id, status, startedAt: startAtUtc, ...(completedAt ? { completedAt, endedAt: completedAt } : {}) },
    });
    return { ...c, appointment };
  }

  const draft = (token, consultationId, items = [item()], generalNotes = 'Drink plenty of water') =>
    api('POST', `/api/v1/consultations/${consultationId}/prescriptions`, { token, body: { items, generalNotes } });
  const issue = (token, id) => api('POST', `/api/v1/prescriptions/${id}/issue`, { token, body: {} });
  async function issued(doctor, c) {
    const d = await draft(doctor.token, c.id);
    assert.equal(d.status, 201, JSON.stringify(d.body));
    const r = await issue(doctor.token, d.body.data.id);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.data;
  }
  const sha = async (buf) => (await import('node:crypto')).createHash('sha256').update(buf).digest('hex');

  /* ------------------------------------------------------------ prescriptions */

  test('assigned doctor drafts, edits and issues; PDF stored privately with SHA-256; patient sees, lists and downloads', async () => {
    const p = await account('PATIENT', { name: 'Amina Prescribed' });
    const d = await account('DOCTOR', { name: 'Dr. Hodan Prescriber' });
    const c = await consultation(p, d);

    const created = await draft(d.token, c.id);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.status, 'DRAFT');
    assert.equal(created.body.data.reference, null);
    assert.deepEqual(created.body.data.actions, { edit: true, issue: true, discard: true, replace: false, cancel: false });
    const id = created.body.data.id;
    assert.equal((await api('GET', `/api/v1/prescriptions/${id}`, { token: p.token })).status, 404, 'patient never sees drafts');
    assert.equal((await api('GET', '/api/v1/me/prescriptions', { token: p.token })).body.data.total, 0);

    const edited = await api('PATCH', `/api/v1/prescriptions/${id}`, { token: d.token, body: { items: [item(), item('Paracetamol 500 mg')] } });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.data.items.length, 2);

    const r = await issue(d.token, id);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.status, 'VALID');
    assert.match(r.body.data.reference, /^FD-RX-\d{4}-\d{6}$/);
    assert.ok(r.body.data.issuedAt);
    const row = await prisma.prescription.findUniqueOrThrow({ where: { id } });
    assert.match(row.pdfFileKey, /^prescriptions\/[0-9a-f-]+\/[0-9a-f-]+\.pdf$/);
    assert.match(row.pdfSha256, /^[0-9a-f]{64}$/);
    assert.ok(row.pdfGeneratedAt && row.verificationTokenHash);
    for (const leaked of ['pdfFileKey', 'pdfSha256', 'verificationTokenHash', row.pdfFileKey, row.verificationTokenHash]) assert.ok(!JSON.stringify(r.body).includes(leaked), `response leaks ${leaked}`);

    const notification = await prisma.notification.findFirst({ where: { userId: p.user.id, eventKey: `prescription.issued:${id}` } });
    assert.ok(notification, 'patient notified');
    assert.ok(!JSON.stringify(notification).includes('Amoxicillin'), 'notification carries no medicine names');

    const mine = await api('GET', `/api/v1/prescriptions/${id}`, { token: p.token });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.data.items[0].medicineName, 'Amoxicillin 500 mg');
    assert.equal('actions' in mine.body.data, false, 'patients get no actions');
    assert.equal((await api('GET', '/api/v1/me/prescriptions', { token: p.token })).body.data.items[0].id, id);
    assert.equal((await api('GET', '/api/v1/doctors/me/prescriptions', { token: d.token })).body.data.items[0].id, id);

    const pdf = await api('GET', `/api/v1/prescriptions/${id}/pdf`, { token: p.token });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(pdf.headers.get('cache-control'), 'private, no-store');
    assert.equal(await sha(pdf.buf), row.pdfSha256, 'served bytes are the stored, checksummed PDF');
    assert.equal((await api('GET', `/api/v1/prescriptions/${id}/pdf`)).status, 401, 'never public');
  });

  test('only the verified, active, assigned doctor prescribes — and only within the issuing window', async () => {
    const p = await account('PATIENT');
    const d = await account('DOCTOR');
    const other = await account('DOCTOR');
    const c = await consultation(p, d);
    assert.equal((await draft(other.token, c.id)).status, 404, 'unassigned doctor');
    assert.equal((await draft(p.token, c.id)).status, 403, 'patients cannot create prescriptions');
    assert.equal((await draft(admin.token, c.id)).status, 403, 'admins cannot create prescriptions');

    const late = await consultation(p, d, { status: 'COMPLETED', hoursAgo: 25 });
    const closed = await draft(d.token, late.id);
    assert.equal(closed.status, 409);
    assert.equal(closed.body.error.code, 'PRESCRIPTION_WINDOW_CLOSED');
    const recent = await consultation(p, d, { status: 'COMPLETED', hoursAgo: 23 });
    assert.equal((await draft(d.token, recent.id)).status, 201, 'within 24 h after the consultation');

    // A draft written in time cannot be issued once the window has passed.
    const stale = await consultation(p, d, { status: 'COMPLETED', hoursAgo: 23 });
    const staleDraft = await draft(d.token, stale.id);
    await prisma.consultation.update({ where: { id: stale.id }, data: { completedAt: new Date(Date.now() - 25 * HOUR) } });
    assert.equal((await issue(d.token, staleDraft.body.data.id)).status, 409, 'issuing is re-checked against the window');

    await prisma.doctorProfile.update({ where: { id: d.profile.id }, data: { accountStatus: 'SUSPENDED' } });
    assert.equal((await draft(d.token, c.id)).status, 403, 'suspended doctor');
    await prisma.doctorProfile.update({ where: { id: d.profile.id }, data: { accountStatus: 'ACTIVE', verificationStatus: 'PENDING' } });
    assert.equal((await draft(d.token, c.id)).status, 403, 'unverified doctor');
    await prisma.doctorProfile.update({ where: { id: d.profile.id }, data: { verificationStatus: 'VERIFIED' } });
  });

  test('patients only see their own prescriptions; doctors only their own', async () => {
    const p = await account('PATIENT');
    const q = await account('PATIENT');
    const d = await account('DOCTOR');
    const other = await account('DOCTOR');
    const rx = await issued(d, await consultation(p, d));
    assert.equal((await api('GET', `/api/v1/prescriptions/${rx.id}`, { token: q.token })).status, 404);
    assert.equal((await api('GET', `/api/v1/prescriptions/${rx.id}/pdf`, { token: q.token })).status, 404);
    assert.equal((await api('GET', `/api/v1/prescriptions/${rx.id}`, { token: other.token })).status, 404);
    assert.equal((await api('GET', '/api/v1/me/prescriptions', { token: q.token })).body.data.total, 0);
    assert.equal((await api('GET', `/api/v1/prescriptions/${rx.id}`, { token: admin.token })).status, 403, 'admins have no prescription content route');
  });

  test('issued prescriptions are immutable (API and database triggers)', async () => {
    const p = await account('PATIENT');
    const d = await account('DOCTOR');
    const rx = await issued(d, await consultation(p, d));
    const edit = await api('PATCH', `/api/v1/prescriptions/${rx.id}`, { token: d.token, body: { generalNotes: 'changed' } });
    assert.equal(edit.status, 409);
    assert.equal(edit.body.error.code, 'PRESCRIPTION_NOT_DRAFT');
    assert.equal((await api('DELETE', `/api/v1/prescriptions/${rx.id}`, { token: d.token })).status, 409);
    const itemRow = await prisma.prescriptionItem.findFirstOrThrow({ where: { prescriptionId: rx.id } });
    await assert.rejects(prisma.prescriptionItem.update({ where: { id: itemRow.id }, data: { dose: '2 capsules' } }), /cannot be changed/);
    await assert.rejects(prisma.prescriptionItem.delete({ where: { id: itemRow.id } }), /cannot be changed/);
    await assert.rejects(prisma.prescriptionItem.create({ data: { prescriptionId: rx.id, medicineName: 'Extra', dose: '1', frequency: '1', duration: '1' } }), /cannot be changed/);
    await assert.rejects(prisma.prescription.update({ where: { id: rx.id }, data: { generalNotes: 'tampered' } }), /immutable/);
    await assert.rejects(prisma.prescription.update({ where: { id: rx.id }, data: { pdfSha256: '0'.repeat(64) } }), /immutable/);
    await assert.rejects(prisma.prescription.update({ where: { id: rx.id }, data: { status: 'DRAFT' } }), /invalid prescription status/);
    await assert.rejects(prisma.prescription.delete({ where: { id: rx.id } }), /cannot be deleted/);
    await assert.rejects(prisma.prescription.update({ where: { id: rx.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } }), /prescription_cancellation_fields/);
  });

  test('replacement keeps the original (REPLACED, with who/when/why) and issues a linked new prescription', async () => {
    const p = await account('PATIENT');
    const d = await account('DOCTOR');
    const original = await issued(d, await consultation(p, d));
    const originalRow = await prisma.prescription.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal((await api('POST', `/api/v1/prescriptions/${original.id}/replace`, { token: d.token, body: { items: [item()] } })).status, 400, 'reason required');

    const r = await api('POST', `/api/v1/prescriptions/${original.id}/replace`, { token: d.token, body: { reason: 'Dose corrected after lab results', items: [{ ...item(), dose: '2 capsules' }] } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const replacement = r.body.data;
    assert.equal(replacement.status, 'VALID');
    assert.equal(replacement.replaces.id, original.id);
    assert.notEqual(replacement.reference, original.reference);

    const old = await prisma.prescription.findUniqueOrThrow({ where: { id: original.id }, include: { items: true } });
    assert.equal(old.status, 'REPLACED');
    assert.equal(old.replacementReason, 'Dose corrected after lab results');
    assert.equal(old.statusChangedByUserId, d.user.id);
    assert.ok(old.replacedAt);
    assert.equal(old.items[0].dose, '1 capsule', 'original content unchanged');
    assert.equal(old.pdfSha256, originalRow.pdfSha256, 'original PDF kept as evidence');
    const oldPdf = await api('GET', `/api/v1/prescriptions/${original.id}/pdf`, { token: p.token });
    assert.equal(oldPdf.status, 200, 'the replaced prescription stays downloadable');

    const again = await api('POST', `/api/v1/prescriptions/${original.id}/replace`, { token: d.token, body: { reason: 'Second attempt at replacing', items: [item()] } });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'PRESCRIPTION_ALREADY_REPLACED');
    const view = await api('GET', `/api/v1/prescriptions/${original.id}`, { token: p.token });
    assert.equal(view.body.data.status, 'REPLACED');
    assert.equal(view.body.data.replacedBy.id, replacement.id);
    assert.equal(view.body.data.replacementReason, 'Dose corrected after lab results');
    assert.ok(await prisma.notification.findFirst({ where: { userId: p.user.id, eventKey: `prescription.replaced:${replacement.id}` } }), 'patient notified');
  });

  test('cancellation requires a reason, records actor/time/reason, and is final', async () => {
    const p = await account('PATIENT');
    const d = await account('DOCTOR');
    const rx = await issued(d, await consultation(p, d));
    assert.equal((await api('POST', `/api/v1/prescriptions/${rx.id}/cancel`, { token: d.token, body: {} })).status, 400);
    assert.equal((await api('POST', `/api/v1/prescriptions/${rx.id}/cancel`, { token: d.token, body: { reason: 'short' } })).status, 400);
    assert.equal((await api('POST', `/api/v1/prescriptions/${rx.id}/cancel`, { token: p.token, body: { reason: 'I do not want it anymore' } })).status, 403, 'patients cannot cancel');
    const r = await api('POST', `/api/v1/prescriptions/${rx.id}/cancel`, { token: d.token, body: { reason: 'Prescribed for the wrong consultation' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.status, 'CANCELLED');
    const row = await prisma.prescription.findUniqueOrThrow({ where: { id: rx.id } });
    assert.equal(row.cancelledByUserId, d.user.id);
    assert.equal(row.cancellationReason, 'Prescribed for the wrong consultation');
    assert.ok(row.cancelledAt);
    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'Prescription', entityId: rx.id, newValues: { path: ['status'], equals: 'CANCELLED' } } });
    assert.deepEqual(audit.oldValues, { status: 'VALID' });
    assert.ok(!JSON.stringify(audit).includes('wrong consultation'), 'audit keeps the transition, not the free-text reason');
    assert.equal((await api('POST', `/api/v1/prescriptions/${rx.id}/cancel`, { token: d.token, body: { reason: 'Cancelling a second time' } })).status, 409);
    assert.equal((await api('POST', `/api/v1/prescriptions/${rx.id}/replace`, { token: d.token, body: { reason: 'Replace after cancel?', items: [item()] } })).status, 409);
    assert.equal((await api('GET', '/api/v1/me/prescriptions', { token: p.token })).body.data.items[0].status, 'CANCELLED', 'cancelled stays in history');
  });

  test('concurrent issue / replace / cancel are safe (exactly one wins)', async () => {
    const p = await account('PATIENT');
    const d = await account('DOCTOR');
    const c = await consultation(p, d);
    const dr = await draft(d.token, c.id);
    const both = await Promise.all([issue(d.token, dr.body.data.id), issue(d.token, dr.body.data.id)]);
    assert.deepEqual(both.map((x) => x.status).sort(), [200, 409]);
    assert.equal(await prisma.prescription.count({ where: { consultationId: c.id, status: 'VALID' } }), 1);

    const rx = await issued(d, await consultation(p, d));
    const race = await Promise.all([
      api('POST', `/api/v1/prescriptions/${rx.id}/cancel`, { token: d.token, body: { reason: 'Cancelled in a race test' } }),
      api('POST', `/api/v1/prescriptions/${rx.id}/replace`, { token: d.token, body: { reason: 'Replaced in a race test', items: [item()] } }),
      api('POST', `/api/v1/prescriptions/${rx.id}/replace`, { token: d.token, body: { reason: 'Replaced in a race test too', items: [item()] } }),
    ]);
    assert.equal(race.filter((x) => x.status < 300).length, 1, `one winner: ${race.map((x) => x.status)}`);
    assert.ok(['CANCELLED', 'REPLACED'].includes((await prisma.prescription.findUniqueOrThrow({ where: { id: rx.id } })).status));
    assert.ok((await prisma.prescription.count({ where: { replacesPrescriptionId: rx.id } })) <= 1);
  });

  test('a tampered PDF is refused and a security event is audited (no content logged)', async () => {
    const p = await account('PATIENT');
    const d = await account('DOCTOR');
    const rx = await issued(d, await consultation(p, d));
    const row = await prisma.prescription.findUniqueOrThrow({ where: { id: rx.id } });
    writeFileSync(join(process.env.STORAGE_DIR, ...row.pdfFileKey.split('/')), Buffer.from('%PDF-1.7 tampered %%EOF'));
    const r = await api('GET', `/api/v1/prescriptions/${rx.id}/pdf`, { token: p.token });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.code, 'PRESCRIPTION_PDF_INTEGRITY');
    const event = await prisma.auditLog.findFirst({ where: { entityType: 'SecurityEvent', entityId: rx.id } });
    assert.equal(event.newValues.event, 'PRESCRIPTION_PDF_CHECKSUM_MISMATCH');
  });

  test('public QR verification: status, date and doctor only — never patient or clinical data', async () => {
    const p = await account('PATIENT', { name: 'Hidden Patient Name' });
    const d = await account('DOCTOR', { name: 'Dr. Public Name' });
    const rx = await issued(d, await consultation(p, d));
    // The raw token is only inside the PDF's QR code; reconstruct it by issuing through the service is not
    // possible (only the hash is stored), so verify through a token we control.
    const { hashVerificationToken, newVerificationToken } = await import('../../../apps/api/src/modules/prescriptions/prescription.service.js');
    const token = newVerificationToken();
    const c2 = await consultation(p, d);
    const dr = await prisma.prescription.create({ data: { consultationId: c2.id, patientId: p.profile.id, doctorId: d.profile.id, status: 'DRAFT', issuedAt: null, items: { create: [item('Secret Medicine')] } } });
    await prisma.prescription.update({ where: { id: dr.id }, data: { status: 'VALID', issuedAt: new Date(), reference: `FD-RX-TEST-${uniq()}`, verificationTokenHash: hashVerificationToken(token) } });
    const v = await api('GET', `/api/v1/public/prescriptions/verify/${token}`);
    assert.equal(v.status, 200);
    assert.deepEqual(Object.keys(v.body.data).sort(), ['cancelledAt', 'issuedAt', 'issuedBy', 'status', 'valid']);
    assert.equal(v.body.data.valid, true);
    assert.equal(v.body.data.issuedBy.name, 'Dr. Public Name');
    const text = JSON.stringify(v.body);
    for (const secret of ['Hidden Patient Name', 'Secret Medicine', p.profile.id, dr.id, c2.id, 'verificationTokenHash']) assert.ok(!text.includes(secret), `leaks ${secret}`);
    await prisma.prescription.update({ where: { id: dr.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: 'Test cancellation reason' } });
    const cancelled = await api('GET', `/api/v1/public/prescriptions/verify/${token}`);
    assert.deepEqual([cancelled.body.data.valid, cancelled.body.data.status], [false, 'CANCELLED']);
    assert.ok(!JSON.stringify(cancelled.body).includes('Test cancellation reason'));
    assert.deepEqual((await api('GET', `/api/v1/public/prescriptions/verify/${newVerificationToken()}`)).body.data, { valid: false });
    assert.equal((await api('GET', '/api/v1/public/prescriptions/verify/..%2F..%2Fetc')).status, 400);
    assert.ok(rx.reference, 'the issued prescription carries a reference used on the PDF');
  });

  /* ------------------------------------------------------------ consultation summary */

  test('consultation summary: patient sees only shared sections + prescriptions; nothing enters medical history', async () => {
    const p = await account('PATIENT');
    const d = await account('DOCTOR');
    const other = await account('PATIENT');
    const c = await consultation(p, d, { status: 'COMPLETED', hoursAgo: 2 });
    await prisma.consultationNote.create({ data: { consultationId: c.id, complaint: 'Headache for 3 days', assessment: 'Private assessment text', diagnosis: 'Tension headache', advice: 'Private advice', shareComplaint: true, shareAssessment: false, shareDiagnosis: true, shareAdvice: false, lockedAt: new Date(Date.now() + 22 * HOUR) } });
    const rx = await issued(d, c);
    const s = await api('GET', `/api/v1/consultations/${c.id}/summary`, { token: p.token });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.deepEqual(s.body.data.sections.map((x) => x.key), ['complaint', 'diagnosis']);
    assert.ok(!JSON.stringify(s.body).includes('Private assessment text') && !JSON.stringify(s.body).includes('Private advice'));
    assert.equal(s.body.data.prescriptions[0].id, rx.id);
    const asDoctor = await api('GET', `/api/v1/consultations/${c.id}/summary`, { token: d.token });
    assert.equal(asDoctor.body.data.sections.length, 4);
    assert.equal((await api('GET', `/api/v1/consultations/${c.id}/summary`, { token: other.token })).status, 404);
    assert.equal(await prisma.medicalHistoryEntry.count({ where: { history: { patientId: p.profile.id } } }), 0, 'summaries are not copied into longitudinal history');

    // The documents page list: counts only, own consultations only.
    const list = await api('GET', '/api/v1/me/consultation-summaries', { token: p.token });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const row = list.body.data.items.find((x) => x.consultationId === c.id);
    assert.deepEqual([row.sharedSectionCount, row.prescriptionCount], [2, 1]);
    for (const secret of ['Headache', 'Private assessment', 'Tension headache', 'Private advice']) assert.ok(!JSON.stringify(list.body).includes(secret), `list leaks ${secret}`);
    assert.equal((await api('GET', '/api/v1/me/consultation-summaries', { token: other.token })).body.data.items.length, 0);
    assert.equal((await api('GET', '/api/v1/me/consultation-summaries', { token: d.token })).status, 403);
  });

  /* ------------------------------------------------------------ medical documents */

  const pngFile = () => sharp({ create: { width: 60, height: 60, channels: 3, background: '#0e857e' } }).png().toBuffer();
  const pdfFile = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
  const upload = (token, consultationId, raw, { category = 'LAB_RESULT', name = 'cbc results.pdf', description } = {}) =>
    api('POST', `/api/v1/consultations/${consultationId}/documents?category=${category}${description ? `&description=${encodeURIComponent(description)}` : ''}`, {
      token,
      raw,
      headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) },
    });

  test('patient and assigned doctor share documents; nobody else can see them; archive keeps everything', async () => {
    const p = await account('PATIENT');
    const q = await account('PATIENT');
    const d = await account('DOCTOR');
    const other = await account('DOCTOR');
    const c = await consultation(p, d, { status: 'COMPLETED', hoursAgo: 3 });

    const lab = await upload(p.token, c.id, pdfFile, { description: 'Full blood count' });
    assert.equal(lab.status, 201, JSON.stringify(lab.body));
    assert.equal(lab.body.data.uploadedBy.role, 'PATIENT');
    assert.equal(lab.body.data.mimeType, 'application/pdf');
    assert.ok(!JSON.stringify(lab.body).includes('medical-documents/'), 'storage key never returned');
    assert.ok(await prisma.notification.findFirst({ where: { userId: d.user.id, eventKey: `document.added:${lab.body.data.id}` } }), 'doctor notified');
    const scan = await upload(d.token, c.id, await pngFile(), { category: 'REFERRAL_LETTER', name: 'referral.png' });
    assert.equal(scan.status, 201, JSON.stringify(scan.body));
    assert.ok(await prisma.notification.findFirst({ where: { userId: p.user.id, eventKey: `document.added:${scan.body.data.id}` } }), 'patient notified');

    assert.equal((await api('GET', `/api/v1/consultations/${c.id}/documents`, { token: d.token })).body.data.items.length, 2);
    assert.equal((await api('GET', '/api/v1/me/medical-documents', { token: p.token })).body.data.items.length, 2);
    const dl = await api('GET', `/api/v1/medical-documents/${lab.body.data.id}/download`, { token: d.token });
    assert.equal(dl.status, 200);
    assert.ok(dl.buf.equals(pdfFile));
    assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');

    for (const [who, token] of [['unrelated doctor', other.token], ['another patient', q.token]]) {
      assert.equal((await api('GET', `/api/v1/consultations/${c.id}/documents`, { token })).status, 404, who);
      assert.equal((await api('GET', `/api/v1/medical-documents/${lab.body.data.id}`, { token })).status, 404, who);
      assert.equal((await api('GET', `/api/v1/medical-documents/${lab.body.data.id}/download`, { token })).status, 404, who);
      assert.equal((await upload(token, c.id, pdfFile)).status, 404, who);
    }
    assert.equal((await api('GET', '/api/v1/me/medical-documents', { token: q.token })).body.data.items.length, 0);
    assert.equal((await api('GET', `/api/v1/medical-documents/${lab.body.data.id}/download`, { token: admin.token })).status, 403, 'admins cannot open files');
    assert.equal((await api('GET', `/api/v1/medical-documents/${lab.body.data.id}/download`)).status, 401);

    assert.equal((await api('POST', `/api/v1/medical-documents/${lab.body.data.id}/archive`, { token: d.token, body: {} })).status, 403, 'doctor cannot archive the patient’s upload');
    const archived = await api('POST', `/api/v1/medical-documents/${lab.body.data.id}/archive`, { token: p.token, body: {} });
    assert.equal(archived.status, 200);
    assert.ok(archived.body.data.archivedAt);
    assert.equal((await api('POST', `/api/v1/medical-documents/${lab.body.data.id}/archive`, { token: p.token, body: {} })).status, 409);
    assert.equal((await api('GET', '/api/v1/me/medical-documents', { token: p.token })).body.data.items.length, 1, 'archived hidden by default');
    assert.equal((await api('GET', '/api/v1/me/medical-documents?includeArchived=true', { token: p.token })).body.data.items.length, 2);
    const row = await prisma.consultationAttachment.findUniqueOrThrow({ where: { id: lab.body.data.id } });
    assert.equal(row.archivedByUserId, p.user.id);
    await assert.rejects(prisma.consultationAttachment.delete({ where: { id: row.id } }), /cannot be deleted/);
    await assert.rejects(prisma.consultationAttachment.update({ where: { id: scan.body.data.id }, data: { fileName: 'renamed.png' } }), /immutable/);
    const audits = await prisma.auditLog.findMany({ where: { entityType: 'MedicalDocument', entityId: lab.body.data.id } });
    assert.ok(audits.length >= 3, 'upload, download and archive audited');
    assert.ok(!JSON.stringify(audits).includes('cbc results') && !JSON.stringify(audits).includes('Full blood count'), 'no file names or descriptions in the audit log');
  });

  test('document uploads: content-based type check, 10 MB limit, eligible consultations only', async () => {
    const p = await account('PATIENT');
    const d = await account('DOCTOR');
    const c = await consultation(p, d);
    assert.equal((await upload(p.token, c.id, Buffer.from('<html><script>alert(1)</script></html>'), { name: 'report.pdf' })).status, 415, 'disguised HTML');
    assert.equal((await upload(p.token, c.id, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]), { name: 'lab.png' })).status, 415, 'executable');
    assert.equal((await upload(p.token, c.id, Buffer.from('%PDF-1.4 no end marker'))).status, 422, 'malformed PDF');
    assert.equal((await upload(p.token, c.id, Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10 * 1024 * 1024 + 10)]))).status, 413);
    assert.equal((await upload(p.token, c.id, Buffer.alloc(0))).status, 400);
    assert.equal((await upload(p.token, c.id, pdfFile, { category: 'XRAY' })).status, 400, 'unknown category');
    await prisma.appointment.update({ where: { id: c.appointment.id }, data: { status: 'CANCELLED' } });
    assert.equal((await upload(p.token, c.id, pdfFile)).status, 409, 'cancelled appointment');
  });

  /* ------------------------------------------------------------ admin monitoring */

  test('admin monitoring is metadata only; patients and doctors are refused', async () => {
    const p = await account('PATIENT');
    const d = await account('DOCTOR');
    const c = await consultation(p, d, { status: 'COMPLETED', hoursAgo: 1 });
    const rx = await issued(d, c);
    await upload(p.token, c.id, pdfFile, { name: 'HIV test result.pdf', description: 'Confidential result' });

    const overview = await api('GET', '/api/v1/admin/medical-records/overview', { token: admin.token });
    assert.equal(overview.status, 200, JSON.stringify(overview.body));
    assert.ok(overview.body.data.prescriptions.VALID >= 1 && overview.body.data.documents.total >= 1 && overview.body.data.documents.storageBytes > 0);
    const list = await api('GET', `/api/v1/admin/medical-records/prescriptions?q=${rx.reference}`, { token: admin.token });
    assert.equal(list.body.data.items[0].reference, rx.reference);
    const docs = await api('GET', '/api/v1/admin/medical-records/documents', { token: admin.token });
    const audit = await api('GET', '/api/v1/admin/medical-records/audit', { token: admin.token });
    assert.ok(audit.body.data.items.length > 0);
    const all = JSON.stringify([overview.body, list.body, docs.body, audit.body]);
    for (const secret of ['Amoxicillin', '1 capsule', 'After meals', 'Stop if a rash', 'Drink plenty', 'HIV test', 'Confidential result', 'medical-documents/', 'prescriptions/', p.user.fullName]) {
      assert.ok(!all.includes(secret), `admin output must not contain ${secret}`);
    }
    for (const token of [p.token, d.token]) assert.equal((await api('GET', '/api/v1/admin/medical-records/overview', { token })).status, 403);
  });
});
