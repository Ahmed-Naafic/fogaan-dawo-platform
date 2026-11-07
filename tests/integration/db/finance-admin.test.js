// Admin finance (Phase 8): authorization, filters, refund approve/reject, duplicate prevention,
// commission configuration with historical protection, ledger immutability, idempotency, report
// aggregation and CSV export — real HTTP API against an isolated per-run schema (simulated payments).
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';

const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';
const HOUR = 3_600_000;
const MIN = 60_000;
const WALLET_OK = '+252615551234';

describe('admin finance (Neon, isolated schema, simulated payments)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let server;
  let base;
  let hashPassword;
  let ledger;
  let seq = 0;
  let admin;

  before(async () => {
    process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
    process.env.BCRYPT_ROUNDS = '10';
    process.env.COOKIE_SECURE = 'false';
    process.env.BOOKING_RATE_LIMIT_MAX = '10000';
    db = await setupTestDatabase();
    prisma = db.prisma;
    ctx = await baseData(prisma);
    ({ hashPassword } = await import('../../../apps/api/src/utils/password.js'));
    ledger = await import('../../../apps/api/src/modules/ledger/ledger.service.js');
    const { createApp } = await import('../../../apps/api/src/app.js');
    server = createApp({ authRateLimit: { limit: 10_000 } }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
    admin = await account('ADMIN', 'Admin Finance');
  });

  after(async () => {
    await new Promise((r) => (server ? server.close(r) : r()));
    await db?.teardown();
  });

  /* ------------------------------------------------------------ helpers */
  async function call(method, path, { body, token, client = 'native', headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(client ? { 'x-fogaan-client': client } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, body: json, text, type: res.headers.get('content-type') ?? '', disposition: res.headers.get('content-disposition') ?? '' };
  }
  const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;
  const login = async (email, role) => (await call('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD, role } })).body.data.accessToken;
  async function account(role, fullName = `Person ${uniq()}`) {
    const email = `f-${uniq()}@example.test`;
    const user = await prisma.user.create({ data: { email, fullName, timeZone: 'Africa/Mogadishu', passwordHash: await hashPassword(PASSWORD), roles: { create: [{ roleId: ctx.roles[role].id }] } } });
    let profile = null;
    if (role === 'PATIENT') profile = await prisma.patientProfile.create({ data: { userId: user.id } });
    if (role === 'DOCTOR') profile = await prisma.doctorProfile.create({ data: { userId: user.id, specialtyId: ctx.specialty.id, licenceNumber: `L-${uniq()}`, licenceCountry: 'Somalia', consultationFee: '20.00', verificationStatus: 'VERIFIED', verifiedAt: new Date() } });
    return { user, profile, email, token: await login(email, role) };
  }
  let slotSeq = 0;
  /** Books and pays (through the real simulated payment flow) a slot `hours` ahead with `doctor`. */
  async function paidBooking(patient, doctor, hours = 48, provider = 'EVC_PLUS') {
    slotSeq += 1;
    const startAtUtc = new Date(Date.now() + hours * HOUR + slotSeq * 45 * MIN);
    const slot = await prisma.availabilitySlot.create({ data: { doctorId: doctor.profile.id, startAtUtc, endAtUtc: new Date(startAtUtc.getTime() + 30 * MIN), timeZoneSnapshot: 'Africa/Mogadishu' } });
    const booked = await call('POST', '/api/v1/appointments', { token: patient.token, body: { slotId: slot.id } });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));
    const paid = await call('POST', `/api/v1/appointments/${booked.body.data.id}/payments`, { token: patient.token, body: { provider, wallet: WALLET_OK }, headers: { 'idempotency-key': randomUUID() } });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: booked.body.data.id } });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { appointmentId: appointment.id } });
    return { appointment, payment };
  }
  const fin = (path, opts = {}) => call(opts.method ?? 'GET', `/api/v1/admin/finance${path}`, { token: admin.token, ...opts });
  const setCommission = (percent) => fin('/settings/commission', { method: 'PUT', body: { percent, confirm: true } });

  /* ------------------------------------------------------------ authorization */

  test('only administrators reach finance endpoints; patients and doctors are refused', async () => {
    const p = await account('PATIENT');
    const d = await account('DOCTOR');
    const paths = ['/overview', '/payments', '/refunds', '/doctor-earnings', '/reports', '/reports/export?type=payments', '/settings'];
    for (const path of paths) {
      assert.equal((await call('GET', `/api/v1/admin/finance${path}`)).status, 401, `anonymous ${path}`);
      for (const who of [p, d]) assert.equal((await call('GET', `/api/v1/admin/finance${path}`, { token: who.token })).status, 403, `${path}`);
      assert.equal((await fin(path)).status, 200, `admin ${path}`);
    }
    for (const who of [p, d]) {
      assert.equal((await call('PUT', '/api/v1/admin/finance/settings/commission', { token: who.token, body: { percent: '1', confirm: true } })).status, 403);
      assert.equal((await call('POST', `/api/v1/admin/finance/refunds/${randomUUID()}/reject`, { token: who.token, body: { reason: 'Not eligible under the policy' } })).status, 403);
    }
    assert.equal((await call('PUT', '/api/v1/admin/finance/settings/commission', { token: admin.token, body: { percent: '16', confirm: true }, client: null })).status, 403, 'CSRF header required for writes');
    assert.equal((await fin('/overview?preset=custom&fromDate=2026-10-31&toDate=2026-10-01')).body.error.code, 'FINANCE_RANGE_INVALID');
    assert.equal((await fin('/payments?pageSize=500')).status, 400, 'pagination is validated');
    assert.equal((await fin('/overview?unknown=1')).status, 400, 'unknown query fields rejected');
  });

  /* ------------------------------------------------------------ commission */

  test('commission: validated, confirmed, audited; history keeps the saved rate; snapshots are immutable', async () => {
    for (const [body, code] of [
      [{ percent: '101', confirm: true }, 'COMMISSION_INVALID'],
      [{ percent: '-1', confirm: true }, 'COMMISSION_INVALID'],
      [{ percent: '15.123', confirm: true }, 'COMMISSION_INVALID'],
      [{ percent: '15' }, 'VALIDATION_ERROR'],
      [{ percent: '15', confirm: true, rate: '0.5' }, 'VALIDATION_ERROR'],
    ]) {
      const res = await fin('/settings/commission', { method: 'PUT', body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.error.code, code, JSON.stringify(body));
    }
    assert.equal((await setCommission('15')).body.error.code, 'COMMISSION_UNCHANGED', 'the default is 15 %');

    const doctor = await account('DOCTOR', `Dr. Rate ${uniq()}`);
    const patient = await account('PATIENT');
    const before = await paidBooking(patient, doctor);
    const earningBefore = await prisma.doctorEarning.findUniqueOrThrow({ where: { appointmentId: before.appointment.id } });
    assert.deepEqual([earningBefore.grossAmount.toFixed(2), earningBefore.commissionAmount.toFixed(2), earningBefore.netAmount.toFixed(2)], ['20.00', '3.00', '17.00']);

    const changed = await setCommission('20');
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.data.commission.percent, '20.00');
    assert.equal(changed.body.data.commission.updatedBy, 'Admin Finance');
    assert.deepEqual([changed.body.data.history[0].fromPercent, changed.body.data.history[0].toPercent, changed.body.data.history[0].by], ['15.00', '20.00', 'Admin Finance']);
    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'PlatformSetting', entityId: 'commission_rate' }, orderBy: { createdAt: 'desc' } });
    assert.deepEqual([audit.oldValues.rate, audit.newValues.rate, audit.actorUserId], ['0.1500', '0.2000', admin.user.id]);

    // History is untouched; a new booking uses the new rate.
    const earningAfter = await prisma.doctorEarning.findUniqueOrThrow({ where: { appointmentId: before.appointment.id } });
    assert.equal(earningAfter.commissionAmount.toFixed(2), '3.00', 'existing earning keeps its saved commission');
    const later = await paidBooking(patient, doctor);
    const newEarning = await prisma.doctorEarning.findUniqueOrThrow({ where: { appointmentId: later.appointment.id } });
    assert.equal(newEarning.commissionAmount.toFixed(2), '4.00');
    const detail = await fin(`/payments/${before.payment.id}`);
    assert.deepEqual(detail.body.data.allocation, { gross: '20.00', commissionRate: '0.1500', commission: '3.00', doctorEarning: '17.00', currency: 'USD', status: 'PENDING' });
    const report = await fin('/reports?preset=today');
    const rates = report.body.data.commission.byRate.map((r) => r.percent);
    assert.ok(rates.includes('15.00') && rates.includes('20.00'), 'reports use each payment\'s saved rate');

    // Database-level protection of the snapshot.
    await assert.rejects(prisma.appointment.update({ where: { id: before.appointment.id }, data: { commissionRateSnapshot: '0.2000' } }), /commission_rate_snapshot cannot change/);
    await assert.rejects(prisma.doctorEarning.update({ where: { id: earningBefore.id }, data: { commissionAmount: '4.00' } }), /historical snapshot/);
    await assert.rejects(prisma.doctorEarning.delete({ where: { id: earningBefore.id } }), /cannot be deleted/);
    await prisma.doctorEarning.update({ where: { id: earningBefore.id }, data: { status: 'AVAILABLE' } }); // status may move
    await prisma.doctorEarning.update({ where: { id: earningBefore.id }, data: { status: 'PENDING' } });

    assert.equal((await setCommission('15')).status, 200);
  });

  /* ------------------------------------------------------------ refunds */

  test('refund approval reverses the saved split; double approval and over-refunds are impossible', async () => {
    const doctor = await account('DOCTOR', `Dr. Refund ${uniq()}`);
    const patient = await account('PATIENT');
    const { appointment, payment } = await paidBooking(patient, doctor, 48);
    await setCommission('30'); // a later change must not affect this refund's allocation
    const cancelled = await call('POST', `/api/v1/appointments/${appointment.id}/cancel`, { token: patient.token, body: {} });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    const refund = await prisma.refund.findFirstOrThrow({ where: { paymentId: payment.id } });
    assert.equal(refund.amount.toFixed(2), '20.00', '> 24 h → 100 % (existing policy)');

    const [a, b] = await Promise.all([fin(`/refunds/${refund.id}/process`, { method: 'POST', body: {} }), fin(`/refunds/${refund.id}/process`, { method: 'POST', body: {} })]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], 'concurrent approvals: exactly one wins');
    const done = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    assert.equal(done.status, 'SUCCEEDED');
    assert.equal(done.reviewedBy, admin.user.id);

    const entries = await prisma.financialTransaction.findMany({ where: { refundId: refund.id } });
    const adj = Object.fromEntries(entries.filter((e) => e.type === 'ADJUSTMENT').map((e) => [e.metadata.kind, e.amount.toFixed(2)]));
    assert.deepEqual(adj, { PLATFORM_COMMISSION_REVERSAL: '3.00', DOCTOR_EARNING_REVERSAL: '17.00' }, 'reversal uses the saved 15 %, not the new 30 %');
    assert.equal(entries.filter((e) => e.type === 'REFUND').length, 1);
    assert.ok((await ledger.verifyPaymentLedger(payment.id, prisma)).ok);
    assert.equal((await prisma.doctorEarning.findUniqueOrThrow({ where: { appointmentId: appointment.id } })).status, 'REFUNDED');
    assert.equal((await fin(`/refunds/${refund.id}/process`, { method: 'POST', body: {} })).status, 409);
    assert.equal((await fin(`/refunds/${refund.id}/reject`, { method: 'POST', body: { reason: 'Too late to reject this one' } })).status, 409);
    await assert.rejects(
      (async () => {
        const { createRefundRequest } = await import('../../../apps/api/src/modules/refunds/refund.service.js');
        await prisma.$transaction((tx) => createRefundRequest(tx, { appointmentId: appointment.id, reason: 'extra', amount: '0.01' }));
      })(),
      /Nothing left to refund|exceeds/,
      'a refund can never exceed what was paid',
    );
    await setCommission('15');

    // 50 % band (2–24 h before): allocation of a partial refund.
    const p2 = await account('PATIENT');
    const near = await paidBooking(p2, doctor, 10);
    await call('POST', `/api/v1/appointments/${near.appointment.id}/cancel`, { token: p2.token, body: {} });
    const half = await prisma.refund.findFirstOrThrow({ where: { paymentId: near.payment.id } });
    assert.equal(half.amount.toFixed(2), '10.00');
    assert.equal((await fin(`/refunds/${half.id}/process`, { method: 'POST', body: {} })).status, 200);
    const halfAdj = (await prisma.financialTransaction.findMany({ where: { refundId: half.id, type: 'ADJUSTMENT' } })).map((e) => e.amount.toFixed(2)).sort();
    assert.deepEqual(halfAdj, ['1.50', '8.50']);
    const earnings = await fin(`/doctor-earnings?preset=today&q=${encodeURIComponent(doctor.user.fullName)}`);
    const row = earnings.body.data.items[0];
    assert.deepEqual(
      { gross: row.gross, refunds: row.refunds, deductions: row.refundDeductions, commission: row.platformCommission, net: row.netEarnings, paidOut: row.settlement.paidOut },
      { gross: '40.00', refunds: '30.00', deductions: '25.50', commission: '1.50', net: '8.50', paidOut: null },
      'gross 2×20; refunds 20 + 10; doctor keeps 17 − 17 + 17 − 8.50; nothing reported as paid out',
    );
  });

  test('refund rejection needs a reason, is recorded with actor and time, notifies the patient and releases the amount', async () => {
    const doctor = await account('DOCTOR');
    const patient = await account('PATIENT');
    const { appointment, payment } = await paidBooking(patient, doctor, 48);
    await call('POST', `/api/v1/appointments/${appointment.id}/cancel`, { token: patient.token, body: {} });
    const refund = await prisma.refund.findFirstOrThrow({ where: { paymentId: payment.id } });
    assert.equal((await fin(`/refunds/${refund.id}/reject`, { method: 'POST', body: {} })).status, 400);
    assert.equal((await fin(`/refunds/${refund.id}/reject`, { method: 'POST', body: { reason: 'short' } })).status, 400);
    const res = await fin(`/refunds/${refund.id}/reject`, { method: 'POST', body: { reason: 'Duplicate request already handled by support' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'REJECTED');
    assert.deepEqual([res.body.data.review.by, res.body.data.review.note], ['Admin Finance', 'Duplicate request already handled by support']);
    assert.equal(res.body.data.payment.refundable, '20.00', 'a rejected amount is released');
    assert.ok(res.body.data.history.some((h) => h.status === 'REJECTED' && h.by === 'Admin Finance'));
    const row = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    assert.ok(row.reviewedAt && row.reviewedBy === admin.user.id);
    assert.equal(await prisma.financialTransaction.count({ where: { refundId: refund.id } }), 0, 'no ledger entry for a rejection');
    assert.ok((await prisma.notification.findMany({ where: { userId: patient.user.id } })).some((n) => n.data?.kind === 'refund.rejected'));
    assert.equal((await fin(`/refunds/${refund.id}/reject`, { method: 'POST', body: { reason: 'Second rejection attempt here' } })).body.error.code, 'REFUND_NOT_REVIEWABLE');
    assert.equal((await fin(`/refunds/${refund.id}/process`, { method: 'POST', body: {} })).status, 409);
    const listed = await fin('/refunds?status=REJECTED');
    assert.ok(listed.body.data.items.some((r) => r.id === refund.id && r.review?.note));
  });

  /* ------------------------------------------------------------ ledger */

  test('ledger rows are immutable and references are idempotent', async () => {
    const doctor = await account('DOCTOR');
    const patient = await account('PATIENT');
    const { payment } = await paidBooking(patient, doctor);
    const entry = await prisma.financialTransaction.findFirstOrThrow({ where: { paymentId: payment.id, type: 'PAYMENT' } });
    assert.equal(entry.metadata.commissionRate, '0.15');
    await assert.rejects(prisma.financialTransaction.update({ where: { id: entry.id }, data: { amount: '1.00' } }), /immutable/);
    await assert.rejects(prisma.financialTransaction.delete({ where: { id: entry.id } }), /append-only/);
    await assert.rejects(prisma.financialTransaction.create({ data: { type: 'PAYMENT', status: 'POSTED', amount: '20.00', currency: 'USD', reference: entry.reference, paymentId: payment.id } }), /Unique constraint/);
    const replay = await call('POST', `/api/v1/appointments/${payment.appointmentId}/payments`, { token: patient.token, body: { provider: 'EVC_PLUS', wallet: WALLET_OK }, headers: { 'idempotency-key': randomUUID() } });
    assert.equal(replay.status, 409, 'paying twice is refused');
    assert.equal(await prisma.financialTransaction.count({ where: { paymentId: payment.id, type: 'PAYMENT' } }), 1);
  });

  /* ------------------------------------------------------------ lists, reports, export */

  test('payments: search, filters, date range, pagination and detail', async () => {
    const doctor = await account('DOCTOR', `Dr. Search ${uniq()}`);
    const patient = await account('PATIENT', `Patient Search ${uniq()}`);
    const one = await paidBooking(patient, doctor, 48, 'ZAAD');
    await paidBooking(patient, doctor, 48, 'EDAHAB');
    const byDoctor = await fin(`/payments?q=${encodeURIComponent(doctor.user.fullName)}`);
    assert.equal(byDoctor.body.data.total, 2);
    assert.equal((await fin(`/payments?q=${encodeURIComponent(patient.user.fullName)}`)).body.data.total, 2);
    assert.equal((await fin(`/payments?q=${encodeURIComponent(doctor.user.fullName)}&provider=ZAAD`)).body.data.total, 1);
    assert.equal((await fin(`/payments?q=${encodeURIComponent(doctor.user.fullName)}&status=FAILED`)).body.data.total, 0);
    assert.equal((await fin(`/payments?q=${one.payment.id}`)).body.data.items[0].id, one.payment.id, 'search by payment id');
    const reference = (await prisma.paymentAttempt.findFirstOrThrow({ where: { paymentId: one.payment.id, status: 'SUCCEEDED' } })).providerReference;
    assert.equal((await fin(`/payments?q=${encodeURIComponent(reference)}`)).body.data.items[0].id, one.payment.id, 'search by payment reference');
    assert.equal((await fin(`/payments?q=${encodeURIComponent(doctor.user.fullName)}&preset=today`)).body.data.total, 2);
    assert.equal((await fin(`/payments?q=${encodeURIComponent(doctor.user.fullName)}&preset=custom&fromDate=2025-01-01&toDate=2025-01-31`)).body.data.total, 0);
    const p1 = await fin(`/payments?q=${encodeURIComponent(doctor.user.fullName)}&pageSize=1&page=1`);
    const p2 = await fin(`/payments?q=${encodeURIComponent(doctor.user.fullName)}&pageSize=1&page=2`);
    assert.notEqual(p1.body.data.items[0].id, p2.body.data.items[0].id);
    assert.equal(p1.body.data.items[0].refundState, 'NONE');
    const detail = await fin(`/payments/${one.payment.id}`);
    assert.equal(detail.body.data.appointment.id, one.appointment.id);
    assert.ok(detail.body.data.attempts.length >= 1 && detail.body.data.ledger.length === 3);
    assert.ok(!JSON.stringify(detail.body.data).includes(WALLET_OK), 'full wallet numbers are never returned');
  });

  test('overview and reports add up from stored records; CSV export is admin-only and safe', async () => {
    const doctor = await account('DOCTOR', `=Dr. Formula ${uniq()}`);
    const patient = await account('PATIENT');
    await paidBooking(patient, doctor, 48);
    const o = (await fin('/overview?preset=today&tz=Africa/Mogadishu')).body.data;
    const range = o.range;
    const succeeded = await prisma.payment.aggregate({ where: { status: 'SUCCEEDED', paidAt: { gte: new Date(range.from), lt: new Date(range.to) } }, _sum: { amount: true }, _count: { _all: true } });
    assert.equal(o.grossVolume.amount, succeeded._sum.amount.toFixed(2));
    assert.equal(o.grossVolume.count, succeeded._count._all);
    const refunded = await prisma.refund.aggregate({ where: { status: 'SUCCEEDED', processedAt: { gte: new Date(range.from), lt: new Date(range.to) } }, _sum: { amount: true } });
    assert.equal(o.refunds.amount, refunded._sum.amount ? refunded._sum.amount.toFixed(2) : '0.00');
    const cents = (v) => Math.round(Number(v) * 100);
    assert.equal(cents(o.platformEarnings.amount) + cents(o.doctorEarnings.amount), cents(o.netAfterRefunds), 'commission + doctor earnings = gross − refunds (all from snapshots)');
    assert.equal(o.simulated, true);
    assert.equal(o.commissionRate, '0.1500');

    const r = (await fin('/reports?preset=7d&tz=Africa/Mogadishu')).body.data;
    assert.equal(r.revenue.grossVolume, sumOf(r.trends.daily, 'gross'));
    assert.equal(r.revenue.refunds, sumOf(r.trends.daily, 'refunds'));
    assert.equal(r.commission.net, sumOf(r.trends.daily, 'commission'));
    assert.equal(sumOf(r.byMethod, 'gross'), r.revenue.grossVolume);
    assert.ok(r.trends.monthly.length >= 1);
    assert.equal(r.doctorEarnings.payoutsSupported, false);

    const csv = await fin('/reports/export?type=payments&preset=today');
    assert.equal(csv.status, 200);
    assert.match(csv.type, /text\/csv/);
    assert.match(csv.disposition, /attachment; filename="fogaan-dawo-payments_/);
    assert.match(csv.text, /"payment_id",.*"simulated"/);
    assert.ok(!csv.text.includes(WALLET_OK) && !csv.text.includes('@example.test'), 'no wallet numbers or e-mail addresses');
    assert.ok(csv.text.includes(`"'=Dr. Formula`), 'formula-looking names are neutralised');
    for (const type of ['summary', 'refunds', 'doctor-earnings']) assert.equal((await fin(`/reports/export?type=${type}&preset=30d`)).status, 200, type);
    assert.equal((await fin('/reports/export?type=passwords')).status, 400);
    assert.equal((await call('GET', '/api/v1/admin/finance/reports/export?type=payments', { token: patient.token })).status, 403);
  });
});

function sumOf(rows, key) {
  return (rows.reduce((a, r) => a + Math.round(Number(r[key]) * 100), 0) / 100).toFixed(2);
}
