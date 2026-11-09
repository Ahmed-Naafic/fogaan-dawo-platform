// Simulated payments and refunds over HTTP (no real provider, no real money). Isolated per-run schema.
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';

const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';
const HOUR = 3_600_000;
const WALLET = { ok: '+252615551234', fail: '+252610000001', pending: '+252610000002', pendingThenOk: '+252610000003', refundFails: '+252610000004' };

describe('simulated payments and refunds (Neon, isolated schema)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let server;
  let base;
  let hashPassword;
  let seq = 0;

  before(async () => {
    process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
    process.env.BCRYPT_ROUNDS = '10';
    process.env.COOKIE_SECURE = 'false';
    process.env.BOOKING_RATE_LIMIT_MAX = '10000';
    db = await setupTestDatabase();
    prisma = db.prisma;
    ctx = await baseData(prisma); // commission_rate 0.1500 here is the test schema's placeholder setting
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

  /* ------------------------------------------------------------ helpers */
  async function api(method, path, { body, token, headers = {}, raw = false } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'x-fogaan-client': 'native', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (raw) return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;
  const login = async (email, role) => (await api('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD, ...(role ? { role } : {}) } })).body.data.accessToken;
  async function account(roles) {
    const email = `u-${uniq()}@example.test`;
    const user = await prisma.user.create({ data: { email, fullName: `Person ${uniq()}`, passwordHash: await hashPassword(PASSWORD), roles: { create: roles.map((r) => ({ roleId: ctx.roles[r].id })) } } });
    if (roles.includes('PATIENT')) await prisma.patientProfile.create({ data: { userId: user.id } });
    return { user, email, token: roles[0] === 'DOCTOR' ? null : await login(email, roles[0]) };
  }
  let doctor;
  async function theDoctor() {
    if (doctor) return doctor;
    const d = await account(['DOCTOR']);
    const profile = await prisma.doctorProfile.create({ data: { userId: d.user.id, specialtyId: ctx.specialty.id, licenceNumber: `L-${uniq()}`, licenceCountry: 'Somalia', consultationFee: '20.00', verificationStatus: 'VERIFIED', verifiedAt: new Date() } });
    doctor = { ...d, profile, token: await login(d.email, 'DOCTOR') };
    return doctor;
  }
  let slotSeq = 0;
  /** exact: start exactly `hours` from now (for refund-tier tests); otherwise spaced 45 min apart to avoid overlaps. */
  async function reservation(patient, hours = 48, { exact = false } = {}) {
    const d = await theDoctor();
    slotSeq += 1;
    const startAtUtc = new Date(Date.now() + hours * HOUR + (exact ? slotSeq * 1000 : slotSeq * 45 * 60_000));
    const slot = await prisma.availabilitySlot.create({ data: { doctorId: d.profile.id, startAtUtc, endAtUtc: new Date(startAtUtc.getTime() + 30 * 60_000), timeZoneSnapshot: 'Africa/Mogadishu' } });
    const res = await api('POST', '/api/v1/appointments', { token: patient.token, body: { slotId: slot.id } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { id: res.body.data.id, slot };
  }
  const pay = (patient, appointmentId, provider, wallet, key = randomUUID(), extra = {}) =>
    api('POST', `/api/v1/appointments/${appointmentId}/payments`, { token: patient.token, body: { provider, wallet, ...extra }, headers: { 'idempotency-key': key } });
  const refresh = (patient, appointmentId) => api('POST', `/api/v1/appointments/${appointmentId}/payments/refresh`, { token: patient.token, body: {} });
  const appt = (id) => prisma.appointment.findUniqueOrThrow({ where: { id }, include: { slot: true, payment: { include: { attempts: true } } } });

  /* ------------------------------------------------------------ outcomes */

  test('SUCCESS with each simulated provider confirms the appointment and posts the ledger', async () => {
    const p = await account(['PATIENT']);
    const refs = new Set();
    for (const [provider, prefix] of [['EVC_PLUS', 'EVC-DEMO-'], ['ZAAD', 'ZAAD-DEMO-'], ['EDAHAB', 'EDH-DEMO-']]) {
      const r = await reservation(p);
      const res = await pay(p, r.id, provider, WALLET.ok);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.outcome, 'SUCCESS', provider);
      assert.equal(res.body.data.payment.simulated, true);
      assert.ok(res.body.data.payment.reference.startsWith(prefix), res.body.data.payment.reference);
      refs.add(res.body.data.payment.reference);
      const a = await appt(r.id);
      assert.equal(a.status, 'CONFIRMED');
      assert.equal(a.slot.status, 'BOOKED');
      assert.equal(a.payment.status, 'SUCCEEDED');
      assert.equal(a.payment.provider, provider);
      const ledger = await prisma.financialTransaction.findMany({ where: { paymentId: a.payment.id } });
      const by = Object.fromEntries(ledger.map((e) => [e.type, Number(e.amount)]));
      assert.deepEqual(Object.keys(by).sort(), ['DOCTOR_EARNING', 'PAYMENT', 'PLATFORM_COMMISSION']);
      assert.equal(by.PAYMENT, 20);
      assert.equal(by.PLATFORM_COMMISSION + by.DOCTOR_EARNING, by.PAYMENT, 'PAYMENT = COMMISSION + EARNING');
      assert.equal(by.PLATFORM_COMMISSION, 3, 'commission from the configured (placeholder) setting, not a constant');
    }
    assert.equal(refs.size, 3, 'unique transaction references');
  });

  test('FAILED releases the slot immediately; paying again is refused and the slot can be booked again', async () => {
    const p = await account(['PATIENT']);
    const r = await reservation(p);
    const failed = await pay(p, r.id, 'EVC_PLUS', WALLET.fail);
    assert.equal(failed.body.data.outcome, 'FAILED');
    assert.match(failed.body.data.payment.lastMessage, /Insufficient/);
    const a = await appt(r.id);
    assert.equal(a.status, 'EXPIRED', 'a failed payment ends the reservation');
    assert.equal(a.slot.status, 'AVAILABLE', 'the slot is released at once');
    assert.equal(a.payment.status, 'FAILED', 'the failed attempt stays on record');
    assert.equal(await prisma.financialTransaction.count({ where: { paymentId: a.payment.id } }), 0, 'nothing posted to the ledger');
    const retry = await pay(p, r.id, 'ZAAD', WALLET.ok);
    assert.equal(retry.status, 409);
    assert.equal(retry.body.error.code, 'APPOINTMENT_NOT_PAYABLE');
    // The released slot can be reserved again straight away.
    const again = await api('POST', '/api/v1/appointments', { token: p.token, body: { slotId: a.slotId } });
    assert.equal(again.status, 201);
  });

  test('PENDING never confirms; it resolves on a status check or expires with the reservation', async () => {
    const p = await account(['PATIENT']);
    // pending → approved on the next status check
    const r1 = await reservation(p);
    assert.equal((await pay(p, r1.id, 'EDAHAB', WALLET.pendingThenOk)).body.data.outcome, 'PENDING');
    assert.equal((await appt(r1.id)).status, 'PENDING_PAYMENT', 'pending does not confirm');
    assert.equal((await pay(p, r1.id, 'EDAHAB', WALLET.ok)).body.error.code, 'PAYMENT_PENDING', 'no second charge while one is pending');
    assert.equal((await refresh(p, r1.id)).body.data.outcome, 'SUCCESS');
    assert.equal((await appt(r1.id)).status, 'CONFIRMED');

    // pending forever → the reservation expires (Phase 4 rule) → EXPIRED, slot released
    const r2 = await reservation(p);
    assert.equal((await pay(p, r2.id, 'EVC_PLUS', WALLET.pending)).body.data.outcome, 'PENDING');
    assert.equal((await refresh(p, r2.id)).body.data.outcome, 'PENDING');
    await prisma.appointment.update({ where: { id: r2.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await refresh(p, r2.id)).body.data.outcome, 'EXPIRED');
    const a2 = await appt(r2.id);
    assert.equal(a2.status, 'EXPIRED');
    assert.equal(a2.slot.status, 'AVAILABLE');
    assert.equal(a2.payment.status, 'CANCELLED');
    assert.equal(a2.payment.attempts[0].responseData.outcome, 'EXPIRED');
    assert.equal((await pay(p, r2.id, 'EVC_PLUS', WALLET.ok)).body.error.code, 'APPOINTMENT_NOT_PAYABLE');
  });

  test('EXPIRED: paying after the 10-minute hold releases the slot and confirms nothing', async () => {
    const p = await account(['PATIENT']);
    const r = await reservation(p);
    await prisma.appointment.update({ where: { id: r.id }, data: { holdExpiresAt: new Date(Date.now() - 1000) } });
    const res = await pay(p, r.id, 'ZAAD', WALLET.ok);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.outcome, 'EXPIRED');
    const a = await appt(r.id);
    assert.equal(a.status, 'EXPIRED');
    assert.equal(a.slot.status, 'AVAILABLE');
    assert.equal(await prisma.financialTransaction.count({ where: { payment: { appointmentId: r.id } } }), 0, 'no money recorded');
  });

  /* ------------------------------------------------------------ duplicates and trust */

  test('duplicate payments are impossible: idempotent replays, already-paid refusal, concurrent submits', async () => {
    const p = await account(['PATIENT']);
    const r = await reservation(p);
    const key = randomUUID();
    const first = await pay(p, r.id, 'EVC_PLUS', WALLET.ok, key);
    const replay = await pay(p, r.id, 'EVC_PLUS', WALLET.ok, key);
    assert.equal(replay.body.data.replayed, true, 'same key → same result, no new charge');
    assert.equal(replay.body.data.payment.reference, first.body.data.payment.reference);
    assert.equal((await pay(p, r.id, 'EVC_PLUS', WALLET.ok)).body.error.code, 'PAYMENT_ALREADY_SUCCEEDED');

    const r2 = await reservation(p);
    const results = await Promise.all([1, 2, 3, 4].map(() => pay(p, r2.id, 'ZAAD', WALLET.ok)));
    assert.equal(results.filter((x) => x.body.data?.outcome === 'SUCCESS').length, 1, 'exactly one charge succeeds');
    assert.ok(results.filter((x) => x.status !== 200).every((x) => x.body.error.code === 'PAYMENT_ALREADY_SUCCEEDED'));
    const a = await appt(r2.id);
    assert.equal(a.payment.attempts.length, 1);
    assert.equal(await prisma.financialTransaction.count({ where: { paymentId: a.payment.id, type: 'PAYMENT' } }), 1);
  });

  test('the browser cannot set an outcome, a status or an amount', async () => {
    const p = await account(['PATIENT']);
    const r = await reservation(p);
    for (const extra of [{ status: 'SUCCEEDED' }, { outcome: 'SUCCESS' }, { amount: 1 }]) {
      assert.equal((await pay(p, r.id, 'EVC_PLUS', WALLET.fail, randomUUID(), extra)).status, 400, JSON.stringify(extra));
    }
    assert.equal((await pay(p, r.id, 'PAYPAL', WALLET.ok)).status, 400, 'unknown provider');
    assert.equal((await pay(p, r.id, 'EVC_PLUS', '12345')).body.error.code, 'WALLET_INVALID');
    const noKey = await api('POST', `/api/v1/appointments/${r.id}/payments`, { token: p.token, body: { provider: 'EVC_PLUS', wallet: WALLET.ok } });
    assert.equal(noKey.status, 400, 'Idempotency-Key required');
    assert.equal((await appt(r.id)).status, 'PENDING_PAYMENT');
  });

  test('only the owner pays, sees history and downloads receipts; admins can open any receipt', async () => {
    const p = await account(['PATIENT']);
    const other = await account(['PATIENT']);
    const r = await reservation(p);
    assert.equal((await api('POST', `/api/v1/appointments/${r.id}/payments`, { body: { provider: 'EVC_PLUS', wallet: WALLET.ok }, headers: { 'idempotency-key': randomUUID() } })).status, 401);
    assert.equal((await pay(other, r.id, 'EVC_PLUS', WALLET.ok)).status, 404, "another patient's reservation");
    assert.equal((await api('GET', `/api/v1/appointments/${r.id}/checkout`, { token: other.token })).status, 404);
    const d = await theDoctor();
    assert.equal((await api('GET', '/api/v1/payments', { token: d.token })).status, 403, 'doctors are not patients');

    const unpaid = (await api('GET', '/api/v1/payments', { token: p.token })).body.data;
    assert.equal(unpaid.length, 0);
    const paid = await pay(p, r.id, 'EDAHAB', WALLET.ok);
    const paymentId = paid.body.data.payment.id;
    const history = (await api('GET', '/api/v1/payments', { token: p.token })).body.data;
    assert.deepEqual(history.map((x) => x.id), [paymentId]);
    assert.equal((await api('GET', '/api/v1/payments', { token: other.token })).body.data.length, 0);

    const receipt = await api('GET', `/api/v1/payments/${paymentId}/receipt`, { token: p.token, raw: true });
    assert.equal(receipt.status, 200);
    assert.equal(receipt.headers.get('content-type'), 'application/pdf');
    assert.match(receipt.headers.get('content-disposition'), /attachment; filename="fogaan-dawo-demo-receipt-EDH-DEMO-/);
    const text = receipt.buffer.toString('latin1');
    assert.ok(text.startsWith('%PDF-1.4') && text.includes('DEMO PAYMENT RECEIPT') && text.includes('NO REAL MONEY'), 'a real PDF, clearly marked as demo');
    assert.equal((await api('GET', `/api/v1/payments/${paymentId}/receipt`, { token: other.token, raw: true })).status, 404, 'own receipts only');
    const admin = await account(['ADMIN']);
    assert.equal((await api('GET', `/api/v1/admin/finance/payments/${paymentId}/receipt`, { token: admin.token, raw: true })).status, 200);
    const r2 = await reservation(p);
    await pay(p, r2.id, 'EVC_PLUS', WALLET.fail);
    const failedId = (await appt(r2.id)).payment.id;
    assert.equal((await api('GET', `/api/v1/payments/${failedId}/receipt`, { token: p.token })).body.error.code, 'RECEIPT_UNAVAILABLE');
  });

  /* ------------------------------------------------------------ refunds */

  test('refunds follow the policy, are processed by an admin through the simulator, and never twice', async () => {
    const p = await account(['PATIENT']);
    const admin = await account(['ADMIN']);
    // >24 h: 100 %
    const r1 = await reservation(p, 200, { exact: true });
    await pay(p, r1.id, 'EVC_PLUS', WALLET.ok);
    const c1 = await api('POST', `/api/v1/appointments/${r1.id}/cancel`, { token: p.token, body: {} });
    assert.equal(c1.body.data.refund.amount, '20.00');
    // 2–24 h: 50 %
    const r2 = await reservation(p, 10, { exact: true });
    await pay(p, r2.id, 'ZAAD', WALLET.ok);
    assert.equal((await api('POST', `/api/v1/appointments/${r2.id}/cancel`, { token: p.token, body: {} })).body.data.refund.amount, '10.00');
    // <2 h: nothing
    const r3 = await reservation(p, 0.5, { exact: true });
    await pay(p, r3.id, 'EDAHAB', WALLET.ok);
    assert.equal((await api('POST', `/api/v1/appointments/${r3.id}/cancel`, { token: p.token, body: {} })).body.data.refund, null);

    const requested = (await api('GET', '/api/v1/admin/finance/refunds?status=REQUESTED', { token: admin.token })).body.data.items;
    const refund = requested.find((x) => x.appointment.id === r1.id);
    assert.ok(refund && refund.simulated);
    const [a, b] = await Promise.all([
      api('POST', `/api/v1/admin/finance/refunds/${refund.id}/process`, { token: admin.token, body: {} }),
      api('POST', `/api/v1/admin/finance/refunds/${refund.id}/process`, { token: admin.token, body: {} }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], 'processed exactly once');
    const done = [a, b].find((x) => x.status === 200).body.data;
    assert.equal(done.outcome, 'SUCCESS');
    assert.equal(done.refund.status, 'SUCCEEDED');
    assert.ok(done.refund.reference.startsWith('EVCR-DEMO-'));
    assert.equal(await prisma.financialTransaction.count({ where: { refundId: refund.id, type: 'REFUND' } }), 1, 'one REFUND ledger entry');
    assert.equal((await api('POST', `/api/v1/admin/finance/refunds/${refund.id}/process`, { token: admin.token, body: {} })).body.error.code, 'REFUND_NOT_REQUESTED');
    const earning = await prisma.doctorEarning.findUniqueOrThrow({ where: { appointmentId: r1.id } });
    assert.equal(earning.status, 'REFUNDED');

    // the patient's history shows the refund
    const mine = (await api('GET', '/api/v1/payments', { token: p.token })).body.data.find((x) => x.appointment.id === r1.id);
    assert.equal(mine.refunds[0].status, 'SUCCEEDED');
  });

  test('a failed simulated refund is visible, can be retried, and can never exceed what was paid', async () => {
    const p = await account(['PATIENT']);
    const admin = await account(['ADMIN']);
    const r = await reservation(p, 72);
    await pay(p, r.id, 'EVC_PLUS', WALLET.refundFails);
    await api('POST', `/api/v1/appointments/${r.id}/cancel`, { token: p.token, body: {} });
    const refund = (await api('GET', '/api/v1/admin/finance/refunds?status=REQUESTED', { token: admin.token })).body.data.items.find((x) => x.appointment.id === r.id);
    const processed = await api('POST', `/api/v1/admin/finance/refunds/${refund.id}/process`, { token: admin.token, body: {} });
    assert.equal(processed.body.data.outcome, 'FAILED');
    assert.equal(processed.body.data.refund.status, 'FAILED');
    assert.ok(await prisma.notification.findFirst({ where: { userId: admin.user.id, title: 'Refund failed' } }), 'admins are notified');
    assert.equal(await prisma.financialTransaction.count({ where: { refundId: refund.id } }), 0, 'no ledger entry for a failed refund');

    const retry = await api('POST', `/api/v1/admin/finance/refunds/${refund.id}/retry`, { token: admin.token, body: {} });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.data.refund.status, 'REQUESTED');
    assert.equal(retry.body.data.refund.amount, '20.00');
    const again = await api('POST', `/api/v1/admin/finance/refunds/${refund.id}/retry`, { token: admin.token, body: {} });
    assert.equal(again.status, 409, 'the open retry already covers the whole remaining amount');
    assert.equal((await api('POST', `/api/v1/admin/finance/refunds/${retry.body.data.refund.id}/retry`, { token: admin.token, body: {} })).body.error.code, 'REFUND_NOT_FAILED');
  });

  /* ------------------------------------------------------------ admin dashboard */

  test('admin finance: simulated overview, filters, details with ledger and audit; admins only', async () => {
    const p = await account(['PATIENT']);
    const admin = await account(['ADMIN']);
    await pay(p, (await reservation(p)).id, 'ZAAD', WALLET.fail); // a failed attempt (its slot is released)
    const r = await reservation(p);
    await pay(p, r.id, 'ZAAD', WALLET.ok);
    const paymentId = (await appt(r.id)).payment.id;
    for (const path of ['/api/v1/admin/finance/overview', '/api/v1/admin/finance/payments', `/api/v1/admin/finance/payments/${paymentId}`, '/api/v1/admin/finance/refunds']) {
      assert.equal((await api('GET', path)).status, 401, path);
      assert.equal((await api('GET', path, { token: p.token })).status, 403, path);
    }
    const ov = (await api('GET', '/api/v1/admin/finance/overview', { token: admin.token })).body.data;
    assert.equal(ov.simulated, true);
    // Phase 8: commission is real (from saved snapshots), no longer a placeholder.
    assert.ok(Number(ov.platformEarnings.amount) >= 3 && Number(ov.doctorEarnings.amount) >= 17);
    assert.equal(ov.commission.rate, '0.1500', 'read from the platform setting');
    assert.ok(Number(ov.revenue.amount) >= 20 && ov.failedAttempts >= 1);
    assert.ok(ov.byProvider.some((x) => x.provider === 'ZAAD'));

    const zaad = (await api('GET', '/api/v1/admin/finance/payments?provider=ZAAD&status=SUCCEEDED', { token: admin.token })).body.data.items;
    assert.ok(zaad.length >= 1 && zaad.every((x) => x.provider === 'ZAAD' && x.status === 'SUCCEEDED'));
    const ref = zaad.find((x) => x.id === paymentId).reference;
    assert.deepEqual((await api('GET', `/api/v1/admin/finance/payments?q=${encodeURIComponent(ref)}`, { token: admin.token })).body.data.items.map((x) => x.id), [paymentId], 'search by reference');
    const detail = (await api('GET', `/api/v1/admin/finance/payments/${paymentId}`, { token: admin.token })).body.data;
    assert.equal(detail.attempts.length, 1);
    assert.deepEqual(detail.ledger.map((e) => e.type).sort(), ['DOCTOR_EARNING', 'PAYMENT', 'PLATFORM_COMMISSION']);
    assert.equal(detail.audit.filter((x) => x.entity === 'PaymentAttempt').length, 1, 'every attempt audited');
    assert.ok(detail.appointment.patient.name);
    assert.equal((await api('GET', '/api/v1/admin/finance/payments?status=BOGUS', { token: admin.token })).status, 400);
  });
});

if (skip) test(`payment simulation tests skipped: ${skip}`, { skip: true }, () => {});
