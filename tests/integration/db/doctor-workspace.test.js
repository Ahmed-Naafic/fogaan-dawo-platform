// Doctor workspace (My Patients, My Earnings) — HTTP API against an isolated per-run schema.
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';

const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';

describe('doctor workspace: my patients and my earnings (Neon, isolated schema)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let server;
  let base;
  let hashPassword;
  let seq = 0;
  let hourCursor = 0;

  before(async () => {
    process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
    process.env.BCRYPT_ROUNDS = '10';
    process.env.COOKIE_SECURE = 'false';
    process.env.PATIENT_RECORDS_RATE_LIMIT_MAX = '10000';
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

  async function api(method, path, { token } = {}) {
    const res = await fetch(base + path, { method, headers: { 'x-fogaan-client': 'native', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;
  const login = async (email, role) =>
    (await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-fogaan-client': 'native' }, body: JSON.stringify({ email, password: PASSWORD, role }) }).then((r) => r.json())).data.accessToken;

  async function patient(name = `Patient ${uniq()}`) {
    const email = `p-${uniq()}@example.test`;
    const user = await prisma.user.create({ data: { email, fullName: name, passwordHash: await hashPassword(PASSWORD), roles: { create: [{ roleId: ctx.roles.PATIENT.id }] }, patientProfile: { create: {} } }, include: { patientProfile: true } });
    return { user, patient: user.patientProfile, email, token: await login(email, 'PATIENT') };
  }
  async function doctor({ verificationStatus = 'VERIFIED' } = {}) {
    const email = `dr-${uniq()}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        fullName: `Dr. Workspace ${uniq()}`,
        passwordHash: await hashPassword(PASSWORD),
        roles: { create: [{ roleId: ctx.roles.DOCTOR.id }] },
        doctorProfile: { create: { specialtyId: ctx.specialty.id, licenceNumber: `L-${uniq()}`, licenceCountry: 'Somalia', consultationFee: '20.00', verificationStatus, verifiedAt: new Date() } },
      },
      include: { doctorProfile: true },
    });
    return { user, doctor: user.doctorProfile, email, token: await login(email, 'DOCTOR') };
  }
  /** An appointment `hoursFromNow` away (negative = in the past), each at a distinct time. */
  async function appointment(p, d, status, hoursFromNow) {
    hourCursor += 1;
    const startAtUtc = new Date(Date.now() + hoursFromNow * 3_600_000 + hourCursor * 60_000);
    const slot = await prisma.availabilitySlot.create({ data: { doctorId: d.id, startAtUtc, endAtUtc: new Date(startAtUtc.getTime() + 30 * 60_000), timeZoneSnapshot: 'Africa/Mogadishu', status: 'BOOKED' } });
    return prisma.appointment.create({ data: { patientId: p.id, doctorId: d.id, slotId: slot.id, status, feeAmount: '20.00', commissionRateSnapshot: '0.1500', startAtUtc, endAtUtc: slot.endAtUtc } });
  }

  test('lists only patients with a paid appointment with THIS doctor, grouped, with last/next visit and search', async () => {
    const d = await doctor();
    const other = await doctor();
    const amina = await patient('Amina Workspace');
    const bashir = await patient('Bashir Workspace');
    const cancelledOnly = await patient('Cancelled Only');
    const othersPatient = await patient('Other Doctors Patient');
    await appointment(amina.patient, d.doctor, 'COMPLETED', -72);
    const next = await appointment(amina.patient, d.doctor, 'CONFIRMED', 24);
    await appointment(amina.patient, d.doctor, 'CANCELLED', 48);
    await appointment(bashir.patient, d.doctor, 'COMPLETED', -24);
    await appointment(cancelledOnly.patient, d.doctor, 'CANCELLED', -10);
    await appointment(cancelledOnly.patient, d.doctor, 'EXPIRED', 30);
    await appointment(othersPatient.patient, other.doctor, 'COMPLETED', -5);

    const r = await api('GET', '/api/v1/doctors/me/patients', { token: d.token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.data.items.map((i) => i.name), ['Amina Workspace', 'Bashir Workspace']); // next visit first
    const a = r.body.data.items[0];
    assert.equal(a.appointments, 2); // the cancelled one does not count
    assert.equal(a.completedConsultations, 1);
    assert.equal(a.nextVisitAt, next.startAtUtc.toISOString());
    assert.ok(a.lastVisitAt);
    assert.equal(a.appointmentId, next.id); // newest eligible appointment authorises the panel
    assert.equal(a.photoUrl, null); // no photo uploaded
    for (const key of ['email', 'phone', 'dateOfBirth', 'address']) assert.equal(key in a, false);

    const search = await api('GET', '/api/v1/doctors/me/patients?q=bash', { token: d.token });
    assert.deepEqual(search.body.data.items.map((i) => i.name), ['Bashir Workspace']);
    const paged = await api('GET', '/api/v1/doctors/me/patients?pageSize=1&page=2', { token: d.token });
    assert.equal(paged.body.data.total, 2);
    assert.deepEqual(paged.body.data.items.map((i) => i.name), ['Bashir Workspace']);
  });

  test('patient detail: every appointment with the doctor; same 403 for unrelated or cancelled-only patients', async () => {
    const d = await doctor();
    const p = await patient();
    const stranger = await patient();
    const cancelledOnly = await patient();
    await appointment(p.patient, d.doctor, 'COMPLETED', -48);
    await appointment(p.patient, d.doctor, 'CANCELLED', 12);
    await appointment(cancelledOnly.patient, d.doctor, 'CANCELLED', 6);

    const r = await api('GET', `/api/v1/doctors/me/patients/${p.patient.id}`, { token: d.token });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.patient.id, p.patient.id);
    assert.deepEqual(r.body.data.appointments.map((x) => x.status), ['CANCELLED', 'COMPLETED']);

    for (const id of [stranger.patient.id, cancelledOnly.patient.id]) {
      const denied = await api('GET', `/api/v1/doctors/me/patients/${id}`, { token: d.token });
      assert.equal(denied.status, 403);
      assert.equal(denied.body.error.code, 'PATIENT_ACCESS_DENIED');
    }
  });

  test('access rules: patients and anonymous callers are refused; a suspended doctor cannot list patients', async () => {
    const p = await patient();
    assert.equal((await api('GET', '/api/v1/doctors/me/patients', { token: p.token })).status, 403);
    assert.equal((await api('GET', '/api/v1/doctors/me/earnings', { token: p.token })).status, 403);
    assert.equal((await api('GET', '/api/v1/doctors/me/patients')).status, 401);
    const suspended = await doctor();
    await prisma.doctorProfile.update({ where: { id: suspended.doctor.id }, data: { accountStatus: 'SUSPENDED' } });
    const r = await api('GET', '/api/v1/doctors/me/patients', { token: suspended.token });
    assert.equal(r.status, 403);
    assert.ok(['ROLE_UNAVAILABLE', 'DOCTOR_NOT_ACTIVE'].includes(r.body.error.code)); // refused before or at the workspace check
  });

  test('my earnings: own snapshots only, refunds deducted from the doctor share, status filter and counts', async () => {
    const d = await doctor();
    const other = await doctor();
    const p = await patient('Earning Patient');
    const paidAppt = await appointment(p.patient, d.doctor, 'COMPLETED', -30);
    const refundedAppt = await appointment(p.patient, d.doctor, 'CANCELLED', -20);
    const othersAppt = await appointment(p.patient, other.doctor, 'COMPLETED', -10);
    for (const [appt, docId, status] of [[paidAppt, d.doctor.id, 'AVAILABLE'], [refundedAppt, d.doctor.id, 'REFUNDED'], [othersAppt, other.doctor.id, 'AVAILABLE']]) {
      const payment = await prisma.payment.create({ data: { appointmentId: appt.id, patientId: p.patient.id, amount: '20.00', currency: 'USD', status: 'SUCCEEDED', provider: 'EVC_PLUS', paidAt: new Date() } });
      await prisma.doctorEarning.create({ data: { appointmentId: appt.id, doctorId: docId, grossAmount: '20.00', commissionAmount: '3.00', netAmount: '17.00', currency: 'USD', status } });
      if (status === 'REFUNDED') {
        await prisma.refund.create({ data: { paymentId: payment.id, appointmentId: appt.id, amount: '20.00', currency: 'USD', status: 'SUCCEEDED', reason: 'Doctor cancelled', processedAt: new Date() } });
      }
    }

    const r = await api('GET', '/api/v1/doctors/me/earnings?preset=all', { token: d.token });
    assert.equal(r.status, 200);
    const data = r.body.data;
    assert.equal(data.total, 2);
    assert.equal(data.totals.gross, '40.00');
    assert.equal(data.totals.doctorBeforeRefunds, '34.00');
    assert.equal(data.totals.doctorRefundDeductions, '17.00');
    assert.equal(data.totals.doctorNet, '17.00');
    assert.deepEqual(data.statusCounts, { AVAILABLE: 1, REFUNDED: 1 });
    const refunded = data.items.find((i) => i.appointmentId === refundedAppt.id);
    assert.equal(refunded.net, '0.00');
    assert.equal(refunded.patientName, 'Earning Patient');
    assert.equal(data.payoutsSupported, false);

    const filtered = await api('GET', '/api/v1/doctors/me/earnings?preset=all&status=AVAILABLE', { token: d.token });
    assert.deepEqual(filtered.body.data.items.map((i) => i.appointmentId), [paidAppt.id]);
    assert.equal((await api('GET', '/api/v1/doctors/me/earnings?status=PAID', { token: d.token })).status, 400);
  });
});
