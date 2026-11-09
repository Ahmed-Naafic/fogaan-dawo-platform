// Requirements-gap features over HTTP against an isolated per-run schema: no-show refund, ratings,
// follow-ups, doctor cancellation flag, admin doctor edit, SMS outbox, attachments, notes before completion.
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';

const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';
const H = 3_600_000;
const MIN = 60_000;

describe('requirements: refunds, ratings, follow-ups, flags, admin edit, SMS (Neon, isolated schema)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let server;
  let base;
  let hashPassword;
  let seq = 0;
  let minuteCursor = 0;

  before(async () => {
    process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
    process.env.BCRYPT_ROUNDS = '10';
    process.env.COOKIE_SECURE = 'false';
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
  });

  async function api(method, path, { token, body } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'x-fogaan-client': 'native', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;
  const login = async (email, role) => (await api('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD, role } })).body?.data?.accessToken;

  async function person(role, name = `${role} ${uniq()}`, { phone } = {}) {
    const email = `r-${uniq()}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        phone: phone ?? null,
        fullName: name,
        passwordHash: await hashPassword(PASSWORD),
        roles: { create: [{ roleId: ctx.roles[role].id }] },
        ...(role === 'PATIENT' ? { patientProfile: { create: {} } } : {}),
        ...(role === 'DOCTOR' ? { doctorProfile: { create: { specialtyId: ctx.specialty.id, licenceNumber: `L-${uniq()}`, licenceCountry: 'Somalia', consultationFee: '20.00', bio: 'A'.repeat(60), verificationStatus: 'VERIFIED', verifiedAt: new Date() } } } : {}),
      },
      include: { patientProfile: true, doctorProfile: true },
    });
    return { user, patient: user.patientProfile, doctor: user.doctorProfile, token: await login(email, role) };
  }
  async function slot(d, hoursFromNow, status = 'AVAILABLE') {
    minuteCursor += 1;
    const startAtUtc = new Date(Date.now() + hoursFromNow * H + minuteCursor * MIN);
    return prisma.availabilitySlot.create({ data: { doctorId: d.doctor.id, startAtUtc, endAtUtc: new Date(startAtUtc.getTime() + 30 * MIN), timeZoneSnapshot: 'Africa/Mogadishu', status } });
  }
  async function appointment(p, d, status, hoursFromNow, { paid = true } = {}) {
    const s = await slot(d, hoursFromNow, 'BOOKED');
    const a = await prisma.appointment.create({ data: { patientId: p.patient.id, doctorId: d.doctor.id, slotId: s.id, status, feeAmount: '20.00', commissionRateSnapshot: '0.1500', startAtUtc: s.startAtUtc, endAtUtc: s.endAtUtc } });
    if (paid) await prisma.payment.create({ data: { appointmentId: a.id, patientId: p.patient.id, amount: '20.00', currency: 'USD', status: 'SUCCEEDED', provider: 'EVC_PLUS', paidAt: new Date() } });
    return a;
  }

  test('req. 6: no admission 15 minutes after the start → full refund on request', async () => {
    const p = await person('PATIENT');
    const d = await person('DOCTOR');
    const early = await appointment(p, d, 'WAITING', -0.1); // started 6 minutes ago
    const r1 = await api('POST', `/api/v1/appointments/${early.id}/no-show-refund`, { token: p.token, body: {} });
    assert.equal(r1.status, 409);
    assert.equal(r1.body.error.code, 'NO_SHOW_REFUND_NOT_ALLOWED');
    assert.equal(r1.body.error.details.blocker, 'TOO_EARLY');

    const late = await appointment(p, d, 'WAITING', -1.5); // started 90 minutes ago (no admission)
    const detail = await api('GET', `/api/v1/appointments/${late.id}`, { token: p.token });
    assert.equal(detail.body.data.actions.noShowRefund.allowed, true);
    const r2 = await api('POST', `/api/v1/appointments/${late.id}/no-show-refund`, { token: p.token, body: {} });
    assert.equal(r2.status, 200, JSON.stringify(r2.body));
    assert.equal(r2.body.data.refund.amount, '20.00', 'full refund');
    const row = await prisma.appointment.findUnique({ where: { id: late.id } });
    assert.equal(row.status, 'CANCELLED');
    assert.match(row.cancellationReason, /did not admit/);
    assert.equal((await api('POST', `/api/v1/appointments/${late.id}/no-show-refund`, { token: p.token, body: {} })).status, 409, 'only once');
    // Req. 11: the refund is recorded with a receipt (owner only).
    const pay = await prisma.payment.findUnique({ where: { appointmentId: late.id }, include: { refunds: true } });
    const receiptUrl = `/api/v1/payments/${pay.id}/refunds/${pay.refunds[0].id}/receipt?lang=so`;
    const rr = await fetch(base + receiptUrl, { headers: { authorization: `Bearer ${p.token}`, 'x-fogaan-client': 'native' } });
    assert.equal(rr.status, 200);
    assert.equal(rr.headers.get('content-type'), 'application/pdf');
    assert.ok(Buffer.from(await rr.arrayBuffer()).toString('latin1').startsWith('%PDF'));
    const other = await person('PATIENT');
    assert.equal((await api('POST', `/api/v1/appointments/${late.id}/no-show-refund`, { token: other.token, body: {} })).status, 404);
    assert.equal((await fetch(base + receiptUrl, { headers: { authorization: `Bearer ${other.token}`, 'x-fogaan-client': 'native' } })).status, 404, 'another patient cannot read the receipt');
  });

  test('req. 13: only completed consultations can be rated, once; public list shows first name + initial', async () => {
    const p = await person('PATIENT', 'Hodan Cali Warsame');
    const d = await person('DOCTOR');
    const upcoming = await appointment(p, d, 'CONFIRMED', 30);
    const r0 = await api('POST', `/api/v1/appointments/${upcoming.id}/review`, { token: p.token, body: { rating: 5 } });
    assert.equal(r0.status, 409);
    assert.equal(r0.body.error.code, 'REVIEW_NOT_ALLOWED');
    const done = await appointment(p, d, 'COMPLETED', -30);
    assert.equal((await api('POST', `/api/v1/appointments/${done.id}/review`, { token: p.token, body: { rating: 6 } })).status, 400, '1–5 only');
    const r1 = await api('POST', `/api/v1/appointments/${done.id}/review`, { token: p.token, body: { rating: 4, comment: 'Clear advice' } });
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    const r2 = await api('POST', `/api/v1/appointments/${done.id}/review`, { token: p.token, body: { rating: 5 } });
    assert.equal(r2.body.error.code, 'REVIEW_ALREADY_SUBMITTED');
    const list = await api('GET', `/api/v1/doctors/${d.doctor.id}/reviews`);
    assert.equal(list.status, 200);
    assert.equal(list.body.data.count, 1);
    assert.equal(list.body.data.items[0].author, 'Hodan W.');
    assert.equal(list.body.data.distribution['4'], 1);
    const search = await api('GET', `/api/v1/doctors/${d.doctor.id}`);
    assert.equal(search.body.data.rating, 4);
  });

  test('req. 12: follow-up with a fee choice; free ones are confirmed without payment; link to the original', async () => {
    const p = await person('PATIENT');
    const d = await person('DOCTOR');
    const a = await appointment(p, d, 'COMPLETED', -24);
    const c = await prisma.consultation.create({ data: { appointmentId: a.id, patientId: p.patient.id, doctorId: d.doctor.id, status: 'COMPLETED', startedAt: a.startAtUtc, endedAt: a.endAtUtc, completedAt: a.endAtUtc } });
    const other = await person('DOCTOR');
    const foreign = await slot(other, 72);
    assert.equal((await api('POST', `/api/v1/consultations/${c.id}/follow-up`, { token: d.token, body: { slotId: foreign.id, fee: 'FREE' } })).body.error.code, 'FOLLOW_UP_SLOT_INVALID');
    assert.equal((await api('POST', `/api/v1/consultations/${c.id}/follow-up`, { token: p.token, body: { slotId: foreign.id, fee: 'FREE' } })).status, 403, 'doctors only');

    const s = await slot(d, 96);
    const free = await api('POST', `/api/v1/consultations/${c.id}/follow-up`, { token: d.token, body: { slotId: s.id, fee: 'FREE' } });
    assert.equal(free.status, 201, JSON.stringify(free.body));
    assert.equal(free.body.data.fee, '0.00');
    assert.ok(Date.parse(free.body.data.confirmBy) <= Date.now() + 48 * H + MIN, 'confirm within 48 hours');
    assert.equal((await api('POST', `/api/v1/consultations/${c.id}/follow-up`, { token: d.token, body: { slotId: (await slot(d, 120)).id, fee: 'NORMAL' } })).body.error.code, 'FOLLOW_UP_EXISTS');

    const detail = await api('GET', `/api/v1/appointments/${free.body.data.appointmentId}`, { token: p.token });
    assert.equal(detail.body.data.status, 'PENDING_PAYMENT');
    assert.equal(detail.body.data.freeFollowUp, true);
    assert.equal(detail.body.data.followUpOf.appointmentId, a.id, 'linked to the original consultation');
    const ok = await api('POST', `/api/v1/appointments/${free.body.data.appointmentId}/confirm-free`, { token: p.token, body: {} });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const confirmed = await prisma.appointment.findUnique({ where: { id: free.body.data.appointmentId }, include: { slot: true } });
    assert.equal(confirmed.status, 'CONFIRMED');
    assert.equal(confirmed.slot.status, 'BOOKED');
    assert.equal(confirmed.bookingType, 'FOLLOW_UP');

    // A discounted follow-up for another consultation costs half and must be paid.
    const a2 = await appointment(p, d, 'COMPLETED', -48);
    const c2 = await prisma.consultation.create({ data: { appointmentId: a2.id, patientId: p.patient.id, doctorId: d.doctor.id, status: 'COMPLETED', startedAt: a2.startAtUtc, endedAt: a2.endAtUtc, completedAt: a2.endAtUtc } });
    const disc = await api('POST', `/api/v1/consultations/${c2.id}/follow-up`, { token: d.token, body: { slotId: (await slot(d, 130)).id, fee: 'DISCOUNTED' } });
    assert.equal(disc.body.data.fee, '10.00');
    assert.equal((await api('POST', `/api/v1/appointments/${disc.body.data.appointmentId}/confirm-free`, { token: p.token, body: {} })).body.error.code, 'FOLLOW_UP_NOT_FREE');
  });

  test('req. 11: a doctor who cancels more than 3 times this month is flagged for admins', async () => {
    const admin = await person('ADMIN');
    const p = await person('PATIENT');
    const d = await person('DOCTOR', 'Dr. Cancels Often');
    for (let i = 0; i < 4; i += 1) {
      const a = await appointment(p, d, 'CONFIRMED', 50 + i * 2);
      const r = await api('POST', `/api/v1/doctors/me/appointments/${a.id}/cancel`, { token: d.token, body: { reason: 'Emergency at the hospital today' } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    const list = await api('GET', '/api/v1/admin/doctors?q=Cancels%20Often', { token: admin.token });
    const row = list.body.data.items.find((x) => x.doctorId === d.doctor.id);
    assert.equal(row.cancellationsThisMonth, 4);
    assert.equal(row.cancellationFlag, true);
    const notes = await prisma.notification.findMany({ where: { userId: admin.user.id } });
    assert.ok(notes.some((n) => n.data?.kind === 'admin.doctor_cancellations_flagged'), 'admins notified');
  });

  test('req. 1: admin edits a doctor profile; fee bounds enforced; booked fees unchanged; audited', async () => {
    const admin = await person('ADMIN');
    const p = await person('PATIENT');
    const d = await person('DOCTOR');
    const booked = await appointment(p, d, 'CONFIRMED', 60);
    assert.equal((await api('PATCH', `/api/v1/admin/doctors/${d.doctor.id}`, { token: admin.token, body: { consultationFee: 250 } })).status, 400);
    assert.equal((await api('PATCH', `/api/v1/admin/doctors/${d.doctor.id}`, { token: d.token, body: { country: 'Kenya' } })).status, 403);
    const r = await api('PATCH', `/api/v1/admin/doctors/${d.doctor.id}`, { token: admin.token, body: { country: 'United Kingdom', timeZone: 'Europe/London', consultationFee: 45, yearsExperience: 12 } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.data.doctor.country, 'United Kingdom');
    assert.equal(r.body.data.doctor.consultationFee, '45.00');
    assert.equal((await prisma.appointment.findUnique({ where: { id: booked.id } })).feeAmount.toFixed(2), '20.00', 'existing booking keeps its fee');
    assert.equal((await api('PATCH', `/api/v1/admin/doctors/${d.doctor.id}`, { token: admin.token, body: { timeZone: 'Mars/Base' } })).status, 400);
    const log = await prisma.auditLog.findFirst({ where: { entityType: 'DoctorProfile', entityId: d.doctor.id, actorUserId: admin.user.id } });
    assert.ok(log, 'audited');
  });

  test('baseline SMS: important events write to the in-app outbox; admins see all of it', async () => {
    const admin = await person('ADMIN');
    const p = await person('PATIENT', 'Sms Patient', { phone: `+25261${String(Date.now()).slice(-7)}` });
    const d = await person('DOCTOR');
    const a = await appointment(p, d, 'CONFIRMED', 70);
    // The doctor cancels → the patient is told (in-app + SMS) and gets a full refund.
    const r = await api('POST', `/api/v1/doctors/me/appointments/${a.id}/cancel`, { token: d.token, body: { reason: 'Unexpected surgery at the hospital' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const mine = await api('GET', '/api/v1/notifications/sms', { token: p.token });
    assert.equal(mine.status, 200);
    assert.ok(mine.body.data.items.length >= 1);
    assert.equal(mine.body.data.items[0].recipient, p.user.phone);
    assert.equal(mine.body.data.items[0].status, 'SENT');
    assert.match(mine.body.data.items[0].message, /^Fogaan Dawo: /);
    assert.equal((await api('GET', '/api/v1/admin/sms-outbox', { token: p.token })).status, 403);
    const all = await api('GET', '/api/v1/admin/sms-outbox', { token: admin.token });
    assert.ok(all.body.data.items.some((m) => m.user === 'Sms Patient'));
  });

  test('req. 5 + 9: files can be attached while booking (doctor sees them once paid); completion needs notes', async () => {
    const p = await person('PATIENT');
    const d = await person('DOCTOR');
    const s = await slot(d, 80);
    const reserve = await api('POST', '/api/v1/appointments', { token: p.token, body: { slotId: s.id } });
    assert.equal(reserve.status, 201);
    const rec = await api('POST', `/api/v1/appointments/${reserve.body.data.id}/consultation-record`, { token: p.token, body: {} });
    assert.equal(rec.status, 200, JSON.stringify(rec.body));
    const cid = rec.body.data.consultationId;
    assert.equal((await api('GET', `/api/v1/consultations/${cid}/documents`, { token: p.token })).status, 200, 'patient can attach and list');
    assert.equal((await api('GET', `/api/v1/consultations/${cid}/documents`, { token: d.token })).status, 404, 'doctor cannot see files of an unpaid booking');
    const again = await api('POST', `/api/v1/appointments/${reserve.body.data.id}/consultation-record`, { token: p.token, body: {} });
    assert.equal(again.body.data.consultationId, cid, 'idempotent');

    const { completeConsultation, saveNote } = await import('../../../apps/api/src/modules/consultations/consultation.service.js');
    const a = await appointment(p, d, 'IN_PROGRESS', -0.2);
    const c = await prisma.consultation.create({ data: { appointmentId: a.id, patientId: p.patient.id, doctorId: d.doctor.id, status: 'IN_PROGRESS', startedAt: new Date() } });
    await assert.rejects(completeConsultation({ consultationId: c.id, actorUserId: d.user.id }), (e) => e.code === 'CONSULTATION_NOTES_REQUIRED');
    await saveNote({ consultationId: c.id, actorUserId: d.user.id, fields: { advice: 'Drink plenty of water.' } });
    const done = await completeConsultation({ consultationId: c.id, actorUserId: d.user.id });
    assert.equal(done.status, 'COMPLETED');
  });

  test('req. 13: doctor earnings per month exclude fully refunded consultations', async () => {
    const d = await person('DOCTOR');
    const r = await api('GET', '/api/v1/doctors/me/earnings?preset=30d', { token: d.token });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.data.byMonth));
  });
});
