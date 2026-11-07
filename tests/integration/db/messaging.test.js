// Patient–doctor messages — HTTP API against an isolated per-run schema.
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';

const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';
const DAY = 86_400_000;

describe('messages between a patient and the assigned doctor (Neon, isolated schema)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let server;
  let base;
  let hashPassword;
  let realtime;
  let seq = 0;
  let minuteCursor = 0;

  before(async () => {
    process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
    process.env.BCRYPT_ROUNDS = '10';
    process.env.COOKIE_SECURE = 'false';
    process.env.MESSAGE_RATE_LIMIT_MAX = '10000';
    db = await setupTestDatabase();
    prisma = db.prisma;
    ctx = await baseData(prisma);
    ({ hashPassword } = await import('../../../apps/api/src/utils/password.js'));
    realtime = await import('../../../apps/api/src/modules/notifications/notification.realtime.js');
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

  async function person(role, name = `${role} ${uniq()}`) {
    const email = `m-${uniq()}@example.test`;
    const user = await prisma.user.create({
      data: {
        email,
        fullName: name,
        passwordHash: await hashPassword(PASSWORD),
        roles: { create: [{ roleId: ctx.roles[role].id }] },
        ...(role === 'PATIENT' ? { patientProfile: { create: {} } } : {}),
        ...(role === 'DOCTOR' ? { doctorProfile: { create: { specialtyId: ctx.specialty.id, licenceNumber: `L-${uniq()}`, licenceCountry: 'Somalia', consultationFee: '20.00', verificationStatus: 'VERIFIED', verifiedAt: new Date() } } } : {}),
      },
      include: { patientProfile: true, doctorProfile: true },
    });
    return { user, patient: user.patientProfile, doctor: user.doctorProfile, token: await login(email, role) };
  }
  async function appointment(p, d, status, hoursFromNow) {
    minuteCursor += 1;
    const startAtUtc = new Date(Date.now() + hoursFromNow * 3_600_000 + minuteCursor * 60_000);
    const slot = await prisma.availabilitySlot.create({ data: { doctorId: d.doctor.id, startAtUtc, endAtUtc: new Date(startAtUtc.getTime() + 30 * 60_000), timeZoneSnapshot: 'Africa/Mogadishu', status: 'BOOKED' } });
    return prisma.appointment.create({ data: { patientId: p.patient.id, doctorId: d.doctor.id, slotId: slot.id, status, feeAmount: '20.00', commissionRateSnapshot: '0.1500', startAtUtc, endAtUtc: slot.endAtUtc } });
  }
  const conv = (id) => `/api/v1/messages/conversations/${id}`;

  test('patient and doctor exchange messages; unread counts, read receipts and live events', async () => {
    const p = await person('PATIENT', 'Hodan Messages');
    const d = await person('DOCTOR', 'Dr. Messages');
    const a = await appointment(p, d, 'CONFIRMED', 24);
    const events = [];
    const stop = realtime.subscribe(d.user.id, (e) => events.push(e));

    const list = await api('GET', '/api/v1/messages/conversations', { token: p.token });
    assert.equal(list.status, 200);
    assert.equal(list.body.data.items.length, 1);
    assert.equal(list.body.data.items[0].open, true);
    assert.equal(list.body.data.items[0].counterpart.name, 'Dr. Messages');

    const sent = await api('POST', `${conv(a.id)}/messages`, { token: p.token, body: { body: '  Should I fast before the call?  ' } });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.data.body, 'Should I fast before the call?');
    assert.equal(sent.body.data.mine, true);
    stop();
    assert.deepEqual(events, [{ type: 'message', appointmentId: a.id, messageId: sent.body.data.id }]);

    assert.equal((await api('GET', '/api/v1/messages/unread-count', { token: d.token })).body.data.unreadMessages, 1);
    const docView = await api('GET', conv(a.id), { token: d.token });
    assert.equal(docView.body.data.messages[0].mine, false);
    assert.equal(docView.body.data.conversation.counterpart.name, 'Hodan Messages');
    assert.equal((await api('POST', `${conv(a.id)}/read`, { token: d.token, body: {} })).body.data.marked, 1);
    assert.equal((await api('GET', '/api/v1/messages/unread-count', { token: d.token })).body.data.unreadMessages, 0);
    const patientView = await api('GET', conv(a.id), { token: p.token });
    assert.ok(patientView.body.data.messages[0].readAt); // "seen"

    await api('POST', `${conv(a.id)}/messages`, { token: d.token, body: { body: 'No need to fast.' } });
    assert.equal((await api('GET', '/api/v1/messages/conversations', { token: p.token })).body.data.unreadTotal, 1);
  });

  test('only participants of paid appointments; others get the same 404; admins have no access', async () => {
    const p = await person('PATIENT');
    const d = await person('DOCTOR');
    const stranger = await person('PATIENT');
    const otherDoctor = await person('DOCTOR');
    const admin = await person('ADMIN');
    const paid = await appointment(p, d, 'CONFIRMED', 30);
    const unpaid = await appointment(p, d, 'PENDING_PAYMENT', 40);
    const cancelled = await appointment(p, d, 'CANCELLED', 50);

    for (const token of [stranger.token, otherDoctor.token]) {
      const r = await api('GET', conv(paid.id), { token });
      assert.equal(r.status, 404);
      assert.equal(r.body.error.code, 'CONVERSATION_NOT_FOUND');
      assert.equal((await api('POST', `${conv(paid.id)}/messages`, { token, body: { body: 'hi' } })).status, 404);
    }
    for (const a of [unpaid, cancelled]) assert.equal((await api('POST', `${conv(a.id)}/messages`, { token: p.token, body: { body: 'hi' } })).status, 404);
    assert.equal((await api('GET', '/api/v1/messages/conversations', { token: admin.token })).status, 403);
    assert.equal((await api('GET', '/api/v1/messages/conversations')).status, 401);
    assert.equal((await api('POST', `${conv(paid.id)}/messages`, { token: p.token, body: { body: '   ' } })).status, 400);
    assert.equal((await api('POST', `${conv(paid.id)}/messages`, { token: p.token, body: { body: 'x'.repeat(2001) } })).status, 400);
    const ids = (await api('GET', '/api/v1/messages/conversations', { token: p.token })).body.data.items.map((i) => i.appointmentId);
    assert.deepEqual(ids, [paid.id]);
  });

  test('the conversation closes 7 days after the consultation and stays readable; paging', async () => {
    const p = await person('PATIENT');
    const d = await person('DOCTOR');
    const recent = await appointment(p, d, 'COMPLETED', -48);
    const old = await appointment(p, d, 'COMPLETED', -24 * 9);
    await prisma.consultation.create({ data: { appointmentId: old.id, patientId: p.patient.id, doctorId: d.doctor.id, status: 'COMPLETED', startedAt: old.startAtUtc, endedAt: old.endAtUtc } });
    await prisma.message.create({ data: { appointmentId: old.id, senderUserId: d.user.id, body: 'Results look fine.', createdAt: new Date(Date.now() - 8 * DAY) } });

    const ok = await api('POST', `${conv(recent.id)}/messages`, { token: p.token, body: { body: 'Thank you, doctor.' } });
    assert.equal(ok.status, 201);
    const closed = await api('POST', `${conv(old.id)}/messages`, { token: p.token, body: { body: 'One more question' } });
    assert.equal(closed.status, 409);
    assert.equal(closed.body.error.code, 'CONVERSATION_CLOSED');
    const read = await api('GET', conv(old.id), { token: p.token });
    assert.equal(read.status, 200);
    assert.equal(read.body.data.conversation.open, false);
    assert.equal(read.body.data.messages[0].body, 'Results look fine.');
    const listed = (await api('GET', '/api/v1/messages/conversations', { token: p.token })).body.data.items.map((i) => i.appointmentId);
    assert.ok(listed.includes(old.id)); // closed but has messages
    assert.equal((await prisma.message.findUnique({ where: { id: ok.body.data.id } })).appointmentId, recent.id);

    for (let i = 0; i < 55; i += 1) await prisma.message.create({ data: { appointmentId: recent.id, senderUserId: d.user.id, body: `m${i}`, createdAt: new Date(Date.now() - (60 - i) * 60_000) } });
    const first = await api('GET', conv(recent.id), { token: p.token });
    assert.equal(first.body.data.messages.length, 50);
    assert.equal(first.body.data.hasMore, true);
    const older = await api('GET', `${conv(recent.id)}?before=${first.body.data.messages[0].id}`, { token: p.token });
    assert.equal(older.body.data.messages.length, 6);
    assert.equal(older.body.data.hasMore, false);
  });
});
