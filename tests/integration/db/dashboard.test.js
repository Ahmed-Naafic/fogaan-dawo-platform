// Dashboard summaries (patient, doctor, public landing stats) — HTTP API against an isolated per-run schema.
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';

const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';
const H = 3_600_000;

describe('dashboard summaries come from real data (Neon, isolated schema)', { skip: skip ?? false }, () => {
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

  async function api(method, path, { token } = {}) {
    const res = await fetch(base + path, { method, headers: { 'x-fogaan-client': 'native', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
    return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) };
  }
  const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;
  const login = async (email, role) =>
    (
      await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-fogaan-client': 'native' }, body: JSON.stringify({ email, password: PASSWORD, role }) }).then((r) => r.json())
    ).data?.accessToken;

  async function person(role, name = `${role} ${uniq()}`) {
    const email = `d-${uniq()}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        fullName: name,
        timeZone: 'Africa/Mogadishu',
        passwordHash: await hashPassword(PASSWORD),
        roles: { create: [{ roleId: ctx.roles[role].id }] },
        ...(role === 'PATIENT' ? { patientProfile: { create: {} } } : {}),
        ...(role === 'DOCTOR' ? { doctorProfile: { create: { specialtyId: ctx.specialty.id, licenceNumber: `L-${uniq()}`, licenceCountry: 'Somalia', consultationFee: '20.00', verificationStatus: 'VERIFIED', verifiedAt: new Date() } } } : {}),
      },
      include: { patientProfile: true, doctorProfile: true },
    });
    return { user, patient: user.patientProfile, doctor: user.doctorProfile, token: await login(email, role) };
  }
  async function appointment(p, d, status, hoursFromNow, { paid = false } = {}) {
    minuteCursor += 1;
    const startAtUtc = new Date(Date.now() + hoursFromNow * H + minuteCursor * 60_000);
    const endAtUtc = new Date(startAtUtc.getTime() + 30 * 60_000);
    const slot = await prisma.availabilitySlot.create({ data: { doctorId: d.doctor.id, startAtUtc, endAtUtc, timeZoneSnapshot: 'Africa/Mogadishu', status: 'BOOKED' } });
    const a = await prisma.appointment.create({ data: { patientId: p.patient.id, doctorId: d.doctor.id, slotId: slot.id, status, feeAmount: '20.00', commissionRateSnapshot: '0.1500', startAtUtc, endAtUtc } });
    if (paid) await prisma.payment.create({ data: { appointmentId: a.id, patientId: p.patient.id, amount: '20.00', currency: 'USD', status: 'SUCCEEDED', provider: 'EVC_PLUS', paidAt: new Date() } });
    return a;
  }

  test('patient summary: own counts and the soonest booked visit; empty state; role checks', async () => {
    const p = await person('PATIENT', 'Summary Patient');
    const other = await person('PATIENT');
    const d = await person('DOCTOR', 'Dr. Summary');

    const empty = await api('GET', '/api/v1/appointments/summary', { token: p.token });
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.data.counts, { upcoming: 0, completed: 0, prescriptions: 0, documents: 0 });
    assert.equal(empty.body.data.nextAppointment, null);

    const later = await appointment(p, d, 'CONFIRMED', 72, { paid: true });
    const soon = await appointment(p, d, 'CONFIRMED', 30, { paid: true });
    await appointment(p, d, 'PENDING_PAYMENT', 10); // unpaid: not "upcoming" on the dashboard
    await appointment(p, d, 'CANCELLED', 20);
    const done = await appointment(p, d, 'COMPLETED', -48, { paid: true });
    const consultation = await prisma.consultation.create({ data: { appointmentId: done.id, patientId: p.patient.id, doctorId: d.doctor.id, status: 'COMPLETED', startedAt: done.startAtUtc, endedAt: done.endAtUtc } });
    await prisma.consultationAttachment.create({ data: { consultationId: consultation.id, uploadedByUserId: d.user.id, fileKey: `k/${uniq()}`, fileName: 'lab.pdf', mimeType: 'application/pdf', fileSize: 1000, attachmentType: 'DOCUMENT' } }).catch(() => null);
    await appointment(other, d, 'CONFIRMED', 5, { paid: true }); // someone else's sooner visit

    const r = await api('GET', '/api/v1/appointments/summary', { token: p.token });
    assert.equal(r.status, 200);
    assert.equal(r.body.data.counts.upcoming, 2);
    assert.equal(r.body.data.counts.completed, 1);
    const next = r.body.data.nextAppointment;
    assert.equal(next.id, soon.id);
    assert.notEqual(next.id, later.id);
    assert.equal(next.doctor.name, 'Dr. Summary');
    assert.equal(next.durationMinutes, 30);
    assert.equal(typeof next.canJoin, 'boolean');
    assert.equal(next.canReschedule, true);

    assert.equal((await api('GET', '/api/v1/appointments/summary')).status, 401);
    assert.equal((await api('GET', '/api/v1/appointments/summary', { token: d.token })).status, 403);
  });

  test('doctor summary: today, waiting, schedule for 7 days, own appointments only', async () => {
    const d = await person('DOCTOR', 'Dr. Day');
    const otherDoctor = await person('DOCTOR');
    const p = await person('PATIENT', 'Day Patient');
    const waiting = await appointment(p, d, 'WAITING', 0.1, { paid: true });
    const tomorrow = await appointment(p, d, 'CONFIRMED', 26, { paid: true });
    const farAway = await appointment(p, d, 'CONFIRMED', 24 * 10, { paid: true });
    await appointment(p, d, 'PENDING_PAYMENT', 3); // unpaid: never on the schedule
    await appointment(p, otherDoctor, 'CONFIRMED', 2, { paid: true });
    await appointment(p, d, 'COMPLETED', -24 * 3, { paid: true });

    const r = await api('GET', '/api/v1/doctors/me/appointments/summary?tz=Africa/Mogadishu', { token: d.token });
    assert.equal(r.status, 200);
    const data = r.body.data;
    assert.equal(data.timeZone, 'Africa/Mogadishu');
    assert.equal(data.days.length, 7);
    assert.equal(data.days[0], data.today);
    assert.equal(data.stats.waiting, 1);
    assert.equal(data.stats.completed30d, 1);
    assert.ok(data.stats.today >= 1);
    const ids = data.schedule.map((a) => a.id);
    assert.ok(ids.includes(waiting.id));
    assert.ok(ids.includes(tomorrow.id));
    assert.ok(!ids.includes(farAway.id));
    assert.ok(data.schedule.every((a) => ['CONFIRMED', 'WAITING', 'IN_PROGRESS'].includes(a.status)));
    assert.equal(data.schedule.find((a) => a.id === waiting.id).patient.name, 'Day Patient');
    assert.ok(data.schedule.every((a) => data.days.includes(a.day)));
    assert.ok(data.stats.earnings30d === null || typeof data.stats.earnings30d.amount === 'string');

    assert.equal((await api('GET', '/api/v1/doctors/me/appointments/summary', { token: p.token })).status, 403);
    assert.equal((await api('GET', '/api/v1/doctors/me/appointments/summary?tz=x'.padEnd(120, 'x'), { token: d.token })).status, 400);
  });

  test('public stats: listed doctors per specialty and completed consultations, no personal data', async () => {
    const r = await api('GET', '/api/v1/public/stats');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('cache-control'), /public/);
    const data = r.body.data;
    const listed = await prisma.doctorProfile.count({ where: { verificationStatus: 'VERIFIED', accountStatus: 'ACTIVE', user: { status: 'ACTIVE' } } });
    assert.equal(data.doctors, listed);
    assert.equal(data.completedConsultations, await prisma.appointment.count({ where: { status: 'COMPLETED' } }));
    assert.equal(data.specialties.reduce((n, s) => n + s.doctors, 0), listed);
    const text = JSON.stringify(data);
    assert.equal(/@example\.test|fullName|email/.test(text), false);
    assert.ok(data.rating === null || data.rating.average <= 5);
  });
});
