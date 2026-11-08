// Admin console (patients, appointments, reports, audit logs) — HTTP API against an isolated per-run schema.
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';

const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';

describe('admin console: patients, appointments, reports, audit logs (Neon, isolated schema)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let server;
  let base;
  let hashPassword;
  let seq = 0;
  let minuteCursor = 0;
  let admin;

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
    admin = await account({ roles: ['ADMIN'], name: 'Admin Console' });
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
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* CSV */
    }
    return { status: res.status, body: json, text, headers: res.headers };
  }
  const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;
  const login = async (email, role) => (await api('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD, role } })).body?.data?.accessToken;

  /** A user with roles; PATIENT gets a patient profile, `doctor: true` a verified doctor profile. */
  async function account({ roles, name = `Person ${uniq()}`, doctor = false }) {
    const email = `ac-${uniq()}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        fullName: name,
        passwordHash: await hashPassword(PASSWORD),
        roles: { create: roles.map((r) => ({ roleId: ctx.roles[r].id })) },
        ...(roles.includes('PATIENT') ? { patientProfile: { create: { dateOfBirth: new Date('1990-01-01'), sex: 'FEMALE', emergencyName: 'Secret Contact' } } } : {}),
        ...(doctor ? { doctorProfile: { create: { specialtyId: ctx.specialty.id, licenceNumber: `L-${uniq()}`, licenceCountry: 'Somalia', consultationFee: '20.00', verificationStatus: 'VERIFIED', verifiedAt: new Date() } } } : {}),
      },
      include: { patientProfile: true, doctorProfile: true },
    });
    return { user, email, patient: user.patientProfile, doctor: user.doctorProfile, token: await login(email, roles[0]) };
  }
  async function appointment(patientId, doctorId, status, hoursFromNow, { paid = false } = {}) {
    minuteCursor += 1;
    const startAtUtc = new Date(Date.now() + hoursFromNow * 3_600_000 + minuteCursor * 60_000);
    const slot = await prisma.availabilitySlot.create({ data: { doctorId, startAtUtc, endAtUtc: new Date(startAtUtc.getTime() + 30 * 60_000), timeZoneSnapshot: 'Africa/Mogadishu', status: 'BOOKED' } });
    const appt = await prisma.appointment.create({ data: { patientId, doctorId, slotId: slot.id, status, feeAmount: '20.00', commissionRateSnapshot: '0.1500', startAtUtc, endAtUtc: slot.endAtUtc, reason: 'Private symptoms text' } });
    if (paid) await prisma.payment.create({ data: { appointmentId: appt.id, patientId, amount: '20.00', currency: 'USD', status: 'SUCCEEDED', provider: 'EVC_PLUS', paidAt: new Date() } });
    return appt;
  }

  test('only administrators reach the admin console', async () => {
    const p = await account({ roles: ['PATIENT'] });
    const d = await account({ roles: ['DOCTOR'], doctor: true });
    for (const path of ['/api/v1/admin/patients', '/api/v1/admin/appointments', '/api/v1/admin/reports/overview', '/api/v1/admin/audit-logs']) {
      assert.equal((await api('GET', path)).status, 401, path);
      assert.equal((await api('GET', path, { token: p.token })).status, 403, path);
      assert.equal((await api('GET', path, { token: d.token })).status, 403, path);
      assert.equal((await api('GET', path, { token: admin.token })).status, 200, path);
    }
  });

  test('patients list and detail show account data only — never clinical fields', async () => {
    const p = await account({ roles: ['PATIENT'], name: 'Listed Patient Zed' });
    const d = await account({ roles: ['DOCTOR'], doctor: true });
    await appointment(p.patient.id, d.doctor.id, 'COMPLETED', -24, { paid: true });
    const list = await api('GET', '/api/v1/admin/patients?q=zed', { token: admin.token });
    assert.equal(list.status, 200);
    const row = list.body.data.items.find((i) => i.patientId === p.patient.id);
    assert.equal(row.appointments, 1);
    assert.equal(row.totalPaid, '20.00');
    assert.equal(row.status, 'ACTIVE');
    const detail = await api('GET', `/api/v1/admin/patients/${p.patient.id}`, { token: admin.token });
    assert.equal(detail.status, 200);
    const text = JSON.stringify(detail.body);
    for (const secret of ['1990-01-01', 'FEMALE', 'Secret Contact', 'Private symptoms text']) assert.equal(text.includes(secret), false, secret);
    assert.equal(detail.body.data.patient.canSuspend, true);
    assert.equal((await api('GET', `/api/v1/admin/patients/${crypto.randomUUID()}`, { token: admin.token })).status, 404);
  });

  test('suspending a patient: signed out, cannot sign in or book, appointments untouched, audited; reactivation audited', async () => {
    const p = await account({ roles: ['PATIENT'], name: 'To Suspend' });
    const d = await account({ roles: ['DOCTOR'], doctor: true });
    const paidFuture = await appointment(p.patient.id, d.doctor.id, 'CONFIRMED', 48, { paid: true });
    const pending = await appointment(p.patient.id, d.doctor.id, 'PENDING_PAYMENT', 72);
    const past = await appointment(p.patient.id, d.doctor.id, 'COMPLETED', -48);
    const before = new Map();
    for (const a of [paidFuture, pending]) before.set(a.id, await prisma.appointment.findUnique({ where: { id: a.id }, include: { slot: true } }));

    assert.equal((await api('POST', `/api/v1/admin/patients/${p.patient.id}/suspend`, { token: admin.token, body: { reason: 'short' } })).status, 400);
    const r = await api('POST', `/api/v1/admin/patients/${p.patient.id}/suspend`, { token: admin.token, body: { reason: 'Repeated abusive messages to doctors' } });
    assert.equal(r.status, 200);
    assert.ok(r.body.data.sessionsRevoked >= 1);
    assert.equal(r.body.data.upcomingAppointments, 2);
    assert.equal(r.body.data.cancelledAppointments, undefined);
    assert.equal(r.body.data.refundRequests, undefined);
    assert.equal(r.body.data.patient.status, 'SUSPENDED');
    assert.equal(r.body.data.patient.suspension.reason, 'Repeated abusive messages to doctors');

    // Access: the old token is dead, sign-in is refused, so no new booking is possible.
    assert.equal((await api('GET', '/api/v1/auth/me', { token: p.token })).status, 401);
    assert.equal((await api('POST', '/api/v1/appointments', { token: p.token, body: {} })).status, 401);
    const signIn = await api('POST', '/api/v1/auth/login', { body: { email: p.email, password: PASSWORD } });
    assert.equal(signIn.status, 403);
    assert.equal(signIn.body.error.code, 'ACCOUNT_SUSPENDED');
    assert.equal(await prisma.session.count({ where: { userId: p.user.id, revokedAt: null } }), 0);

    // Existing appointments: not cancelled, slots not released, no refunds, no status history.
    for (const a of [paidFuture, pending]) {
      const row = await prisma.appointment.findUnique({ where: { id: a.id }, include: { slot: true } });
      assert.equal(row.status, before.get(a.id).status);
      assert.equal(row.slot.status, before.get(a.id).slot.status);
      assert.equal(row.cancelledAt, null);
      assert.equal(await prisma.appointmentStatusHistory.count({ where: { appointmentId: a.id } }), 0);
    }
    assert.equal((await prisma.appointment.findUnique({ where: { id: past.id } })).status, 'COMPLETED');
    assert.equal(await prisma.refund.count({ where: { appointmentId: { in: [paidFuture.id, pending.id] } } }), 0);

    const log = await prisma.auditLog.findFirst({ where: { entityType: 'PatientAccount', entityId: p.user.id, action: 'SUSPEND' } });
    assert.equal(log.actorUserId, admin.user.id);
    assert.equal(log.newValues.reason, 'Repeated abusive messages to doctors');
    assert.equal(log.newValues.upcomingAppointments, 2);

    assert.equal((await api('POST', `/api/v1/admin/patients/${p.patient.id}/suspend`, { token: admin.token, body: { reason: 'Second time is refused' } })).body.error.code, 'PATIENT_ALREADY_SUSPENDED');
    const back = await api('POST', `/api/v1/admin/patients/${p.patient.id}/reactivate`, { token: admin.token, body: { reason: 'Apologised; reviewed by the team' } });
    assert.equal(back.status, 200);
    assert.equal(back.body.data.patient.status, 'ACTIVE');
    const reLog = await prisma.auditLog.findFirst({ where: { entityType: 'PatientAccount', entityId: p.user.id, action: 'UPDATE' } });
    assert.equal(reLog.actorUserId, admin.user.id);
    assert.equal(reLog.oldValues.status, 'SUSPENDED');
    assert.equal(reLog.newValues.status, 'ACTIVE');
    assert.equal(reLog.newValues.reason, 'Apologised; reviewed by the team');
    assert.ok(await login(p.email, 'PATIENT'));
    assert.equal((await prisma.appointment.findUnique({ where: { id: paidFuture.id } })).status, 'CONFIRMED');
  });

  test('administrators and active doctors cannot be suspended from Admin › Patients', async () => {
    const otherAdmin = await account({ roles: ['ADMIN', 'PATIENT'] });
    const r1 = await api('POST', `/api/v1/admin/patients/${otherAdmin.patient.id}/suspend`, { token: admin.token, body: { reason: 'Trying to suspend an admin' } });
    assert.equal(r1.body.error.code, 'PATIENT_ACCOUNT_PROTECTED');
    const doc = await account({ roles: ['PATIENT', 'DOCTOR'], doctor: true });
    const r2 = await api('POST', `/api/v1/admin/patients/${doc.patient.id}/suspend`, { token: admin.token, body: { reason: 'Trying to suspend a doctor' } });
    assert.equal(r2.status, 409);
    assert.equal(r2.body.error.code, 'PATIENT_IS_ACTIVE_DOCTOR');
  });

  test('appointments: filters, counts and detail without the visit reason', async () => {
    const p = await account({ roles: ['PATIENT'], name: 'Appt Filter Patient' });
    const d = await account({ roles: ['DOCTOR'], doctor: true });
    const done = await appointment(p.patient.id, d.doctor.id, 'COMPLETED', -5, { paid: true });
    await appointment(p.patient.id, d.doctor.id, 'CANCELLED', -4);
    const list = await api('GET', `/api/v1/admin/appointments?preset=all&q=${encodeURIComponent('Appt Filter')}&status=COMPLETED`, { token: admin.token });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.data.items.map((i) => i.id), [done.id]);
    assert.equal(list.body.data.statusCounts.CANCELLED, 1);
    const detail = await api('GET', `/api/v1/admin/appointments/${done.id}`, { token: admin.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.payment.amount, '20.00');
    assert.equal(JSON.stringify(detail.body).includes('Private symptoms text'), false);
    assert.equal((await api('GET', '/api/v1/admin/appointments?status=BOGUS', { token: admin.token })).status, 400);
  });

  test('reports: activity counts and CSV export', async () => {
    const r = await api('GET', '/api/v1/admin/reports/overview?preset=all', { token: admin.token });
    assert.equal(r.status, 200);
    const a = r.body.data.appointments;
    assert.equal(a.total, Object.values(a.byStatus).reduce((s, n) => s + n, 0));
    assert.ok(a.completed >= 1);
    assert.equal(r.body.data.granularity, 'month');
    const csv = await api('GET', '/api/v1/admin/reports/export?preset=7d', { token: admin.token });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.text, /"completion_rate"/);
  });

  test('audit logs: clinical entries excluded, values allow-listed, actor filter', async () => {
    const p = await account({ roles: ['PATIENT'] });
    await prisma.auditLog.create({ data: { actorUserId: p.user.id, action: 'OTHER', entityType: 'PatientMedicalHistoryAccess', entityId: p.patient.id, newValues: { action: 'VIEW_MEDICAL_HISTORY' } } });
    await prisma.auditLog.create({ data: { actorUserId: p.user.id, action: 'UPDATE', entityType: 'PatientProfile', entityId: p.patient.id, newValues: { status: 'ok', dateOfBirth: '1990-01-01', appointmentId: '6f1c2d3e-0000-4000-8000-000000000000' } } });
    const r = await api('GET', `/api/v1/admin/audit-logs?preset=all&actorUserId=${p.user.id}`, { token: admin.token });
    assert.equal(r.status, 200);
    const types = r.body.data.items.map((i) => i.entityType);
    assert.equal(types.includes('PatientMedicalHistoryAccess'), false);
    const profile = r.body.data.items.find((i) => i.entityType === 'PatientProfile');
    assert.deepEqual(profile.newValues, { status: 'ok', appointmentId: '6F1C2D3E' });
    const clinical = await api('GET', '/api/v1/admin/audit-logs?preset=all&entityType=PatientMedicalHistoryAccess', { token: admin.token });
    assert.equal(clinical.body.data.items.some((i) => i.entityType === 'PatientMedicalHistoryAccess'), false);
  });

  // Last: it changes platform-wide booking rules for the rest of this schema.
  test('settings: defaults, validation, audited change applied to new holds and to refund previews', async () => {
    const DEFAULTS = { paymentHoldMinutes: 10, followUpDeadlineHours: 48, maxFreeReschedules: 1, freeRescheduleMinHours: 24, fullRefundMinHours: 24, partialRefundMinHours: 2 };
    const p = await account({ roles: ['PATIENT'] });
    assert.equal((await api('GET', '/api/v1/admin/settings', { token: p.token })).status, 403);
    const before = await api('GET', '/api/v1/admin/settings', { token: admin.token });
    assert.equal(before.status, 200);
    assert.deepEqual(before.body.data.bookingPolicy.values, DEFAULTS);
    assert.equal(before.body.data.commission.percent, '15.00');

    const put = (body) => api('PUT', '/api/v1/admin/settings/booking-policy', { token: admin.token, body });
    assert.equal((await put({ ...DEFAULTS, paymentHoldMinutes: 15 })).status, 400); // no confirm
    const badOrder = await put({ ...DEFAULTS, partialRefundMinHours: 30, confirm: true });
    assert.equal(badOrder.body.error.code, 'BOOKING_POLICY_INVALID');
    assert.equal((await put({ ...DEFAULTS, paymentHoldMinutes: 2, confirm: true })).body.error.code, 'BOOKING_POLICY_INVALID');
    assert.equal((await put({ ...DEFAULTS, confirm: true })).body.error.code, 'BOOKING_POLICY_UNCHANGED');

    // A paid appointment 10 h ahead: 50 % under the defaults (2–24 h band).
    const d = await account({ roles: ['DOCTOR'], doctor: true });
    const appt = await appointment(p.patient.id, d.doctor.id, 'CONFIRMED', 10, { paid: true });
    const preview = async () => (await api('GET', `/api/v1/appointments/${appt.id}`, { token: p.token })).body.data;
    assert.equal((await preview()).actions.cancel.rate, 0.5);

    const saved = await put({ ...DEFAULTS, paymentHoldMinutes: 20, fullRefundMinHours: 6, partialRefundMinHours: 1, confirm: true });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.bookingPolicy.values.paymentHoldMinutes, 20);
    assert.equal(saved.body.data.bookingPolicy.history.length, 1);
    assert.deepEqual(saved.body.data.bookingPolicy.history[0].after, { paymentHoldMinutes: 20, fullRefundMinHours: 6, partialRefundMinHours: 1 });

    const after = await preview();
    assert.equal(after.actions.cancel.rate, 1); // 10 h > new 6 h cut-off
    assert.equal(after.policy.fullRefundMinHours, 6);

    // A new standard reservation is held for the new 20 minutes.
    const slot = await prisma.availabilitySlot.create({ data: { doctorId: d.doctor.id, startAtUtc: new Date(Date.now() + 96 * 3_600_000), endAtUtc: new Date(Date.now() + 96 * 3_600_000 + 30 * 60_000), timeZoneSnapshot: 'Africa/Mogadishu' } });
    const { reserveSlot } = await import('../../../apps/api/src/modules/appointments/appointment.service.js');
    const now = new Date();
    const held = await reserveSlot({ patientId: p.patient.id, slotId: slot.id, now });
    assert.equal(held.holdExpiresAt.getTime() - now.getTime(), 20 * 60_000);

    const audit = await api('GET', '/api/v1/admin/audit-logs?preset=all&entityType=PlatformSetting', { token: admin.token });
    assert.deepEqual(audit.body.data.items[0].newValues, { paymentHoldMinutes: 20, fullRefundMinHours: 6, partialRefundMinHours: 1 });
  });
});
