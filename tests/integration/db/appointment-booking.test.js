// Appointment booking over HTTP: reservation, double-booking, expiry, cancellation refunds,
// free reschedule, doctor cancellation and access rules. Isolated per-run schema (never public).
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';

const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';
const HOUR = 3_600_000;

describe('appointment booking (Neon, isolated schema)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let server;
  let base;
  let hashPassword;
  let payments;
  let appointments;
  let seq = 0;
  let slotOffset = 0;

  before(async () => {
    process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
    process.env.BCRYPT_ROUNDS = '10';
    process.env.COOKIE_SECURE = 'false';
    process.env.BOOKING_RATE_LIMIT_MAX = '10000';
    process.env.PUBLIC_RATE_LIMIT_MAX = '10000';
    db = await setupTestDatabase();
    prisma = db.prisma;
    ctx = await baseData(prisma);
    ({ hashPassword } = await import('../../../apps/api/src/utils/password.js'));
    payments = await import('../../../apps/api/src/modules/payments/payment.service.js');
    appointments = await import('../../../apps/api/src/modules/appointments/appointment.service.js');
    const { createApp } = await import('../../../apps/api/src/app.js');
    server = createApp({ authRateLimit: { limit: 10_000 } }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((r) => (server ? server.close(r) : r()));
    await db?.teardown();
  });

  /* ------------------------------------------------------------ helpers */
  async function api(method, path, { body, token } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'x-fogaan-client': 'native', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;
  const login = async (email, role) => (await api('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD, ...(role ? { role } : {}) } })).body.data?.accessToken;

  async function user(roles, name = `User ${uniq()}`) {
    const email = `u-${uniq()}@example.test`;
    const u = await prisma.user.create({ data: { email, fullName: name, passwordHash: await hashPassword(PASSWORD), roles: { create: roles.map((r) => ({ roleId: ctx.roles[r].id })) } } });
    const patient = roles.includes('PATIENT') ? await prisma.patientProfile.create({ data: { userId: u.id } }) : null;
    return { user: u, email, patient };
  }
  async function patient() {
    const p = await user(['PATIENT'], `Patient ${uniq()}`);
    return { ...p, token: await login(p.email) };
  }
  async function doctor({ status = 'VERIFIED', fee = '20.00', withPatient = false } = {}) {
    const d = await user(withPatient ? ['DOCTOR', 'PATIENT'] : ['DOCTOR'], `Dr. ${uniq()}`);
    const profile = await prisma.doctorProfile.create({
      data: { userId: d.user.id, specialtyId: ctx.specialty.id, licenceNumber: `L-${uniq()}`, licenceCountry: 'Somalia', consultationFee: fee, verificationStatus: status, verifiedAt: status === 'VERIFIED' ? new Date() : null },
    });
    return { ...d, profile, token: status === 'VERIFIED' ? await login(d.email, 'DOCTOR') : null };
  }
  /** A 30-minute open slot starting `hours` from now. Callers use hours far enough apart that one doctor's slots never overlap. */
  async function slot(doctorId, hours) {
    slotOffset += 1;
    const startAtUtc = new Date(Date.now() + hours * HOUR + slotOffset * 1000);
    return prisma.availabilitySlot.create({ data: { doctorId, startAtUtc, endAtUtc: new Date(startAtUtc.getTime() + 30 * 60_000), timeZoneSnapshot: 'Africa/Mogadishu' } });
  }
  const book = (p, slotId, extra = {}) => api('POST', '/api/v1/appointments', { token: p.token, body: { slotId, ...extra } });
  /** Payment is provider-confirmed in a later phase; the existing service stands in for the provider callback. */
  const pay = (appointmentId) => payments.recordSuccessfulPayment({ appointmentId, provider: 'EVC_PLUS', idempotencyKey: `pay-${appointmentId}`, responseData: { test: true } });
  async function bookAndPay(p, s) {
    const res = await book(p, s.id);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    await pay(res.body.data.id);
    return res.body.data.id;
  }

  /* ------------------------------------------------------------ booking */

  test('a patient reserves a slot: 10-minute hold, fee from the doctor, slot held, history recorded', async () => {
    const d = await doctor({ fee: '25.00' });
    const s = await slot(d.profile.id, 48);
    const p = await patient();
    const before = Date.now();
    const res = await book(p, s.id, { reason: 'Chest pain when climbing stairs' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const a = res.body.data;
    assert.equal(a.status, 'PENDING_PAYMENT');
    assert.equal(a.fee, '25.00', 'price always comes from the doctor profile');
    const hold = Date.parse(a.holdExpiresAt) - before;
    assert.ok(hold > 9.5 * 60_000 && hold <= 10.5 * 60_000, `10-minute hold (${hold} ms)`);
    assert.ok(a.serverTime, 'server time for an accurate countdown');
    assert.equal(a.doctor.id, d.profile.id);
    assert.deepEqual(a.history.map((h) => h.to), ['PENDING_PAYMENT']);
    assert.equal((await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: s.id } })).status, 'HELD');
    assert.ok((await api('GET', '/api/v1/appointments?scope=upcoming', { token: p.token })).body.data.some((x) => x.id === a.id));
    assert.equal((await api('GET', `/api/v1/appointments/${a.id}`, { token: p.token })).body.data.actions.cancel.allowed, true);
    assert.equal((await book(p, (await slot(d.profile.id, 50)).id, { feeAmount: 1 })).status, 400, 'no price or other fields from the client');
  });

  test('double booking is impossible, even with concurrent attempts', async () => {
    const d = await doctor();
    const s = await slot(d.profile.id, 30);
    const patients = await Promise.all([1, 2, 3, 4, 5].map(() => patient()));
    const results = await Promise.all(patients.map((p) => book(p, s.id)));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409], `exactly one reservation wins: ${statuses}`);
    assert.ok(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'SLOT_UNAVAILABLE'));
    assert.equal(await prisma.appointment.count({ where: { slotId: s.id, status: { in: ['PENDING_PAYMENT', 'CONFIRMED'] } } }), 1);
    const winner = patients[results.findIndex((r) => r.status === 201)];
    assert.equal((await book(winner, s.id)).status, 409, 'not even the same patient twice');
  });

  test('an expired reservation releases the slot; late payment is refused; the slot can be booked again', async () => {
    const d = await doctor();
    const s = await slot(d.profile.id, 30);
    const p1 = await patient();
    const a = (await book(p1, s.id)).body.data;
    await prisma.appointment.update({ where: { id: a.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } }); // the 10 minutes have passed
    await prisma.availabilitySlot.update({ where: { id: s.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });

    const detail = (await api('GET', `/api/v1/appointments/${a.id}`, { token: p1.token })).body.data;
    assert.equal(detail.status, 'EXPIRED', 'shown as expired immediately');
    assert.equal(detail.actions.cancel.allowed, false);
    assert.ok((await api('GET', '/api/v1/appointments?scope=past', { token: p1.token })).body.data.some((x) => x.id === a.id), 'moves to past');
    await assert.rejects(pay(a.id), /Payment window has expired/, 'payment timeout');

    const p2 = await patient();
    assert.equal((await book(p2, s.id)).status, 201, 'a stale hold never blocks the next patient');
    assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { id: a.id } })).status, 'EXPIRED');

    // the periodic sweep releases holds nobody else touched
    const s2 = await slot(d.profile.id, 31);
    const b = (await book(p1, s2.id)).body.data;
    await prisma.appointment.update({ where: { id: b.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    assert.ok((await appointments.expireStaleHolds()) >= 1);
    assert.equal((await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: s2.id } })).status, 'AVAILABLE');
  });

  /* ------------------------------------------------------------ cancellation */

  test('patient cancellation refunds 100 % (>24 h), 50 % (2–24 h) or nothing (<2 h); unpaid holds just release', async () => {
    const d = await doctor({ fee: '20.00' });
    const p = await patient();
    const cases = [
      [48, '1', '20.00'],
      [10, '0.5', '10.00'],
      [1, '0', null],
    ];
    for (const [hours, rate, amount] of cases) {
      const s = await slot(d.profile.id, hours);
      const id = await bookAndPay(p, s);
      const preview = (await api('GET', `/api/v1/appointments/${id}`, { token: p.token })).body.data.actions.cancel;
      assert.equal(String(preview.rate), rate, `preview at ${hours} h`);
      const res = await api('POST', `/api/v1/appointments/${id}/cancel`, { token: p.token, body: { reason: 'Plans changed' } });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(String(res.body.data.refundRate), rate);
      assert.equal(res.body.data.refund?.amount ?? null, amount, `${hours} h → ${amount}`);
      assert.equal(res.body.data.appointment.status, 'CANCELLED');
      assert.equal((await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: s.id } })).status, 'AVAILABLE', 'slot offered again');
      assert.equal(await prisma.refund.count({ where: { appointmentId: id } }), amount ? 1 : 0);
    }
    const s = await slot(d.profile.id, 40);
    const unpaid = (await book(p, s.id)).body.data;
    const res = await api('POST', `/api/v1/appointments/${unpaid.id}/cancel`, { token: p.token, body: {} });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.refund, null, 'nothing was paid, nothing to refund');
    assert.equal((await api('POST', `/api/v1/appointments/${unpaid.id}/cancel`, { token: p.token, body: {} })).body.error.code, 'APPOINTMENT_NOT_CANCELLABLE', 'cannot cancel twice');
  });

  test('doctor cancellation is a full refund even at the last minute; the slot is withdrawn and the patient notified', async () => {
    const d = await doctor({ fee: '30.00' });
    const p = await patient();
    const s = await slot(d.profile.id, 1);
    const id = await bookAndPay(p, s);
    assert.equal((await api('POST', `/api/v1/doctors/me/appointments/${id}/cancel`, { token: d.token, body: {} })).status, 400, 'reason required');
    const other = await doctor();
    assert.equal((await api('POST', `/api/v1/doctors/me/appointments/${id}/cancel`, { token: other.token, body: { reason: 'Not my appointment at all.' } })).status, 404, "another doctor's appointment");
    const res = await api('POST', `/api/v1/doctors/me/appointments/${id}/cancel`, { token: d.token, body: { reason: 'Emergency surgery at the hospital.' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.refund.amount, '30.00', 'full refund');
    assert.equal((await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: s.id } })).status, 'CANCELLED', 'withdrawn, not re-offered');
    assert.ok(await prisma.notification.findFirst({ where: { userId: p.user.id, title: 'Appointment cancelled' } }));
    const detail = (await api('GET', `/api/v1/appointments/${id}`, { token: p.token })).body.data;
    assert.match(detail.cancellationReason, /Emergency surgery/);
    assert.equal(detail.refunds.length, 1);
    const list = (await api('GET', '/api/v1/doctors/me/appointments?scope=past', { token: d.token })).body.data;
    assert.ok(list.some((x) => x.id === id && x.patient.name));
  });

  /* ------------------------------------------------------------ reschedule */

  test('one free reschedule more than 24 h before creates a linked appointment and preserves the original', async () => {
    const d = await doctor({ fee: '20.00' });
    const p = await patient();
    const s1 = await slot(d.profile.id, 48);
    const s2 = await slot(d.profile.id, 72);
    const s3 = await slot(d.profile.id, 96);
    const id = await bookAndPay(p, s1);

    const res = await api('POST', `/api/v1/appointments/${id}/reschedule`, { token: p.token, body: { slotId: s2.id } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const moved = res.body.data;
    assert.notEqual(moved.id, id, 'a new appointment');
    assert.equal(moved.status, 'CONFIRMED');
    assert.equal(moved.rescheduledFrom.id, id, 'linked to the original');
    assert.equal(moved.payment.status, 'SUCCEEDED', 'paid by the original payment');
    const original = await prisma.appointment.findUniqueOrThrow({ where: { id }, include: { statusHistory: true } });
    assert.equal(original.status, 'RESCHEDULED', 'original kept, marked rescheduled');
    assert.deepEqual(original.statusHistory.map((h) => h.toStatus).sort(), ['CONFIRMED', 'PENDING_PAYMENT', 'RESCHEDULED']);
    assert.equal((await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: s1.id } })).status, 'AVAILABLE', 'old time released');
    assert.equal((await prisma.availabilitySlot.findUniqueOrThrow({ where: { id: s2.id } })).status, 'BOOKED');
    assert.equal(await prisma.payment.count({ where: { appointmentId: id } }), 1, 'financial record not moved or duplicated');

    const again = await api('POST', `/api/v1/appointments/${moved.id}/reschedule`, { token: p.token, body: { slotId: s3.id } });
    assert.equal(again.body.error.code, 'RESCHEDULE_NOT_ALLOWED');
    assert.equal(again.body.error.details.blocker, 'ALREADY_RESCHEDULED', 'only one free reschedule');

    // cancelling the rescheduled appointment (>24 h) refunds the original payment in full
    const cancel = await api('POST', `/api/v1/appointments/${moved.id}/cancel`, { token: p.token, body: {} });
    assert.equal(cancel.body.data.refund.amount, '20.00');
  });

  test('reschedule is refused within 24 h, for another doctor, or for a taken slot', async () => {
    const d = await doctor();
    const p = await patient();
    const soon = await bookAndPay(p, await slot(d.profile.id, 20));
    const target = await slot(d.profile.id, 60);
    const late = await api('POST', `/api/v1/appointments/${soon}/reschedule`, { token: p.token, body: { slotId: target.id } });
    assert.equal(late.body.error.details.blocker, 'TOO_LATE');

    const later = await bookAndPay(p, await slot(d.profile.id, 50));
    const otherDoctor = await doctor();
    assert.equal((await api('POST', `/api/v1/appointments/${later}/reschedule`, { token: p.token, body: { slotId: (await slot(otherDoctor.profile.id, 70)).id } })).status, 400, 'same doctor only');
    const taken = await slot(d.profile.id, 80);
    await bookAndPay(await patient(), taken);
    assert.equal((await api('POST', `/api/v1/appointments/${later}/reschedule`, { token: p.token, body: { slotId: taken.id } })).body.error.code, 'SLOT_UNAVAILABLE');
    const unpaid = (await book(p, (await slot(d.profile.id, 90)).id)).body.data;
    assert.equal((await api('POST', `/api/v1/appointments/${unpaid.id}/reschedule`, { token: p.token, body: { slotId: target.id } })).body.error.details.blocker, 'NOT_CONFIRMED');
  });

  /* ------------------------------------------------------------ access */

  test('only patients book; nobody sees another person’s appointment; no self-booking', async () => {
    const d = await doctor({ withPatient: true });
    const s = await slot(d.profile.id, 30);
    const admin = await user(['ADMIN']);
    const adminToken = await login(admin.email, 'ADMIN');
    assert.equal((await api('POST', '/api/v1/appointments', { body: { slotId: s.id } })).status, 401, 'anonymous');
    assert.equal((await api('POST', '/api/v1/appointments', { token: d.token, body: { slotId: s.id } })).status, 403, 'acting as DOCTOR');
    assert.equal((await api('POST', '/api/v1/appointments', { token: adminToken, body: { slotId: s.id } })).status, 403, 'admin');
    const selfAsPatient = await login(d.email, 'PATIENT');
    const self = await api('POST', '/api/v1/appointments', { token: selfAsPatient, body: { slotId: s.id } });
    assert.equal(self.body.error.code, 'SELF_BOOKING_FORBIDDEN');

    const p1 = await patient();
    const p2 = await patient();
    const id = (await book(p1, s.id)).body.data.id;
    assert.equal((await api('GET', `/api/v1/appointments/${id}`, { token: p2.token })).status, 404, 'another patient');
    assert.equal((await api('POST', `/api/v1/appointments/${id}/cancel`, { token: p2.token, body: {} })).status, 404);
    assert.equal((await api('GET', '/api/v1/doctors/me/appointments', { token: p1.token })).status, 403, 'patients cannot use doctor endpoints');
    assert.ok((await api('GET', '/api/v1/doctors/me/appointments', { token: d.token })).body.data.some((x) => x.id === id), 'the doctor sees the booking');
    const forDoctor = (await api('GET', `/api/v1/doctors/me/appointments/${id}`, { token: d.token })).body.data;
    assert.ok(forDoctor.patient.name && !JSON.stringify(forDoctor).includes(p1.email), 'doctor sees the patient name, not their contact details');
  });

  test('unverified and suspended doctors cannot receive bookings', async () => {
    const p = await patient();
    const pending = await doctor({ status: 'PENDING' });
    const res1 = await book(p, (await slot(pending.profile.id, 30)).id);
    assert.equal(res1.status, 409);
    const suspended = await doctor();
    const s = await slot(suspended.profile.id, 30);
    await prisma.doctorProfile.update({ where: { id: suspended.profile.id }, data: { accountStatus: 'SUSPENDED' } });
    assert.equal((await book(p, s.id)).status, 409);
    assert.equal(await prisma.appointment.count({ where: { patientId: p.patient.id } }), 0);
    assert.equal((await book(p, '00000000-0000-4000-8000-000000000000')).status, 404, 'unknown slot');
  });
});

if (skip) test(`appointment booking tests skipped: ${skip}`, { skip: true }, () => {});
