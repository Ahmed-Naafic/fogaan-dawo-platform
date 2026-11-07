// Video consultations (Phase 7): lifecycle, authorization, payment/window eligibility and WebRTC
// signaling — real HTTP API + WebSocket hub against an isolated per-run schema. No media is sent;
// SDP/candidate strings are synthetic. No production table is read or written.
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';

const require = createRequire(import.meta.url);
const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';
const MIN = 60_000;
const SDP = 'v=0\r\no=- 46117317 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';

describe('video consultations (Neon, isolated schema)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let server;
  let base;
  let wsBase;
  let hashPassword;
  let calls;
  let tickets;
  let WebSocket;
  let seq = 0;
  const sockets = [];

  before(async () => {
    process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
    process.env.BCRYPT_ROUNDS = '10';
    process.env.COOKIE_SECURE = 'false';
    process.env.CONSULTATION_RATE_LIMIT_MAX = '100000';
    process.env.WEBRTC_STUN_URLS = 'stun:stun.l.google.com:19302';
    db = await setupTestDatabase();
    prisma = db.prisma;
    ctx = await baseData(prisma);
    ({ hashPassword } = await import('../../../apps/api/src/utils/password.js'));
    calls = await import('../../../apps/api/src/modules/consultations/consultationCall.service.js');
    tickets = await import('../../../apps/api/src/modules/consultations/consultation.tickets.js');
    const { attachSignaling } = await import('../../../apps/api/src/modules/consultations/consultation.signaling.js');
    const { createApp } = await import('../../../apps/api/src/app.js');
    WebSocket = require('ws');
    server = createApp({ authRateLimit: { limit: 10_000 } }).listen(0);
    await new Promise((r) => server.once('listening', r));
    attachSignaling(server, { allowedOrigins: ['http://allowed.test'] });
    base = `http://127.0.0.1:${server.address().port}`;
    wsBase = `ws://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    for (const ws of sockets) ws.terminate();
    const { closeSignaling } = await import('../../../apps/api/src/modules/consultations/consultation.signaling.js');
    closeSignaling();
    await new Promise((r) => (server ? server.close(r) : r()));
    await db?.teardown();
  });

  /* ------------------------------------------------------------ helpers */
  async function api(method, path, { body, token, client = 'native' } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(client ? { 'x-fogaan-client': client } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }
  const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;
  const login = async (email, role) => (await api('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD, role } })).body.data.accessToken;
  async function account(role, fullName = `Person ${uniq()}`) {
    const email = `c-${uniq()}@example.test`;
    const user = await prisma.user.create({ data: { email, fullName, timeZone: 'Africa/Mogadishu', passwordHash: await hashPassword(PASSWORD), roles: { create: [{ roleId: ctx.roles[role].id }] } } });
    let profile;
    if (role === 'PATIENT') profile = await prisma.patientProfile.create({ data: { userId: user.id } });
    if (role === 'DOCTOR') {
      profile = await prisma.doctorProfile.create({ data: { userId: user.id, specialtyId: ctx.specialty.id, licenceNumber: `L-${uniq()}`, licenceCountry: 'Somalia', consultationFee: '20.00', verificationStatus: 'VERIFIED', verifiedAt: new Date() } });
    }
    return { user, profile, email, token: await login(email, role) };
  }

  /** A patient + doctor + appointment (30 min) starting `startInMin` from now; paid unless told otherwise. */
  async function booking({ startInMin = 2, status = 'CONFIRMED', payment = 'SUCCEEDED' } = {}) {
    const p = await account('PATIENT', `Amina ${uniq()}`);
    const d = await account('DOCTOR', `Dr. Hodan ${uniq()}`);
    const startAtUtc = new Date(Date.now() + startInMin * MIN);
    const endAtUtc = new Date(startAtUtc.getTime() + 30 * MIN);
    const slot = await prisma.availabilitySlot.create({ data: { doctorId: d.profile.id, startAtUtc, endAtUtc, timeZoneSnapshot: 'Africa/Mogadishu', status: 'BOOKED' } });
    const a = await prisma.appointment.create({ data: { patientId: p.profile.id, doctorId: d.profile.id, slotId: slot.id, status, feeAmount: '20.00', commissionRateSnapshot: '0.1500', startAtUtc, endAtUtc } });
    let pay = null;
    if (payment) pay = await prisma.payment.create({ data: { appointmentId: a.id, patientId: p.profile.id, provider: 'EVC_PLUS', amount: '20.00', status: payment, paidAt: payment === 'SUCCEEDED' ? new Date() : null } });
    return { p, d, a, pay };
  }
  const join = (who, a) => api('POST', `/api/v1/consultations/${a.id}/join`, { token: who.token });
  const act = (who, id, action) => api('POST', `/api/v1/consultations/${id}/${action}`, { token: who.token });
  const state = (who, id) => api('GET', `/api/v1/consultations/${id}`, { token: who.token });
  const eventTypes = async (consultationId) => (await prisma.consultationEvent.findMany({ where: { consultationId }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] })).map((e) => `${e.participantRole}:${e.eventType}`);
  const kinds = async (userId) => (await prisma.notification.findMany({ where: { userId } })).map((n) => n.data?.kind);

  /** Opens a signaling socket; `messages` collects parsed messages; `closed` resolves to the close code. */
  function connect({ ticket, origin, path = '/api/v1/consultations/signal' } = {}) {
    const ws = new WebSocket(wsBase + path, origin ? { origin } : {});
    sockets.push(ws);
    const messages = [];
    const closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
    const opened = new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    ws.on('message', (data) => messages.push(JSON.parse(data.toString())));
    const waitFor = async (pred, ms = 20_000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const hit = messages.find(pred);
        if (hit) return hit;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`timed out; got ${JSON.stringify(messages.map((m) => m.type))}`);
    };
    const ready = (async () => {
      await opened;
      if (ticket) {
        ws.send(JSON.stringify({ type: 'auth', ticket }));
        await waitFor((m) => m.type === 'ready');
      }
    })();
    ready.catch(() => {}); // rejected upgrades are asserted through `opened`
    opened.catch(() => {});
    return { ws, messages, closed, opened, ready, waitFor, send: (m) => ws.send(JSON.stringify(m)) };
  }

  /* ------------------------------------------------------------ lifecycle */

  test('patient waits, doctor sees and admits, both signal, a drop is recorded, the doctor ends the call', async () => {
    const { p, d, a } = await booking();

    const pj = await join(p, a);
    assert.equal(pj.status, 200, JSON.stringify(pj.body));
    const cid = pj.body.data.consultation.id;
    assert.equal(pj.body.data.consultation.admission, 'WAITING');
    assert.equal(pj.body.data.consultation.role, 'PATIENT');
    assert.equal(pj.body.data.consultation.note, undefined, 'patients never receive doctor notes');
    assert.deepEqual(pj.body.data.iceServers, [{ urls: ['stun:stun.l.google.com:19302'] }]);
    assert.equal(pj.body.data.signaling.path, '/api/v1/consultations/signal');
    assert.ok(pj.body.data.signaling.ticket.length >= 43);
    assert.equal((await prisma.appointment.findUnique({ where: { id: a.id } })).status, 'WAITING');
    assert.ok((await kinds(d.user.id)).includes('consultation.patient_waiting'));

    const dj = await join(d, a);
    assert.equal(dj.status, 200);
    assert.equal(dj.body.data.consultation.id, cid, 'same consultation');
    assert.equal(dj.body.data.consultation.admission, 'WAITING', 'doctor sees the waiting patient');
    assert.equal(dj.body.data.consultation.note, null);

    const ps = connect({ ticket: pj.body.data.signaling.ticket });
    const ds = connect({ ticket: dj.body.data.signaling.ticket });
    await Promise.all([ps.ready, ds.ready]);
    await ds.waitFor((m) => m.type === 'presence' && m.patient && m.doctor);
    assert.deepEqual((await state(d, cid)).body.data.presence, { patient: true, doctor: true });

    // Nothing is relayed before admission.
    ds.send({ type: 'offer', sdp: SDP, session: 'session_aaaa1111' });
    assert.equal((await ds.waitFor((m) => m.type === 'error')).code, 'NOT_ADMITTED');

    assert.equal((await act(p, cid, 'admit')).status, 403, 'patients cannot admit');
    const admitted = await act(d, cid, 'admit');
    assert.equal(admitted.status, 200, JSON.stringify(admitted.body));
    assert.equal(admitted.body.data.status, 'IN_PROGRESS');
    assert.ok(admitted.body.data.startedAt);
    const row = await prisma.consultation.findUnique({ where: { id: cid } });
    assert.ok(row.startedAt && row.admittedAt);
    assert.equal((await prisma.appointment.findUnique({ where: { id: a.id } })).status, 'IN_PROGRESS');
    assert.ok((await kinds(p.user.id)).includes('consultation.admitted'));
    assert.equal((await act(d, cid, 'admit')).status, 409, 'admitting twice is refused');

    // Both are told to refresh; the doctor (offerer) is asked to negotiate.
    await ps.waitFor((m) => m.type === 'state-changed');
    await ds.waitFor((m) => m.type === 'negotiate');
    ds.send({ type: 'offer', sdp: SDP, session: 'session_aaaa1111', extra: 'dropped' });
    assert.deepEqual(await ps.waitFor((m) => m.type === 'offer'), { type: 'offer', sdp: SDP, session: 'session_aaaa1111' });
    ps.send({ type: 'answer', sdp: SDP, session: 'session_aaaa1111' });
    assert.equal((await ds.waitFor((m) => m.type === 'answer')).sdp, SDP);
    ps.send({ type: 'candidate', session: 'session_aaaa1111', candidate: 'candidate:1 1 udp 2122260223 192.0.2.1 54400 typ host', sdpMid: '0', sdpMLineIndex: 0 });
    assert.equal((await ds.waitFor((m) => m.type === 'candidate')).sdpMid, '0');
    ps.send({ type: 'offer', sdp: SDP, session: 'session_aaaa1111' });
    assert.equal((await ps.waitFor((m) => m.type === 'error' && m.code === 'NOT_ALLOWED')).code, 'NOT_ALLOWED', 'patients cannot send offers');
    ps.send({ type: 'media', audio: false, video: true });
    assert.deepEqual(await ds.waitFor((m) => m.type === 'media'), { type: 'media', audio: false, video: true });

    // Unexpected drop → PARTICIPANT_DISCONNECTED; the old ticket cannot be reused; a fresh one reconnects.
    ps.ws.terminate();
    await ds.waitFor((m) => m.type === 'presence' && !m.patient);
    const reused = connect({});
    await reused.opened;
    reused.send({ type: 'auth', ticket: pj.body.data.signaling.ticket });
    assert.equal(await reused.closed, 4001, 'a used ticket is refused');
    const fresh = await act(p, cid, 'ticket');
    assert.equal(fresh.status, 200);
    const ps2 = connect({ ticket: fresh.body.data.signaling.ticket });
    await ps2.ready;
    await ds.waitFor((m) => m.type === 'negotiate' && ds.messages.filter((x) => x.type === 'negotiate').length >= 2);
    await new Promise((r) => setTimeout(r, 300)); // event writes are asynchronous
    const ev = await eventTypes(cid);
    assert.ok(ev.includes('PATIENT:PARTICIPANT_DISCONNECTED') && ev.includes('PATIENT:PARTICIPANT_RECONNECTED'), ev.join());

    // Doctor note during the call (existing note rules); patients cannot write it.
    assert.equal((await api('PUT', `/api/v1/consultations/${cid}/note`, { token: p.token, body: { complaint: 'x' } })).status, 403);
    const note = await api('PUT', `/api/v1/consultations/${cid}/note`, { token: d.token, body: { complaint: 'Headache for 3 days', shareComplaint: true } });
    assert.equal(note.status, 200, JSON.stringify(note.body));
    assert.equal(note.body.data.lockedAt, null);
    assert.equal((await state(d, cid)).body.data.note.complaint, 'Headache for 3 days');

    // Leaving is not ending.
    assert.equal((await act(p, cid, 'leave')).status, 200);
    assert.equal(await ps2.closed, 1000);
    assert.equal((await prisma.consultation.findUnique({ where: { id: cid } })).status, 'IN_PROGRESS');
    assert.equal((await act(p, cid, 'end')).status, 403, 'patients cannot end the consultation');

    const ended = await act(d, cid, 'end');
    assert.equal(ended.status, 200, JSON.stringify(ended.body));
    assert.equal(await ds.closed, 4010, 'sockets are closed when the call ends');
    const done = await prisma.consultation.findUnique({ where: { id: cid }, include: { note: true } });
    assert.equal(done.status, 'COMPLETED');
    assert.equal(done.endedBy, 'DOCTOR');
    assert.ok(done.durationSeconds >= 0);
    assert.equal(done.durationSeconds, Math.floor((done.endedAt - done.startedAt) / 1000));
    assert.equal(done.note.lockedAt.getTime(), done.completedAt.getTime() + 24 * 3_600_000, 'existing 24 h note lock');
    assert.equal(ended.body.data.durationSeconds, done.durationSeconds);
    const appt = await prisma.appointment.findUnique({ where: { id: a.id }, include: { statusHistory: { orderBy: { createdAt: 'asc' } } } });
    assert.equal(appt.status, 'COMPLETED');
    assert.deepEqual(appt.statusHistory.map((h) => h.toStatus), ['WAITING', 'IN_PROGRESS', 'COMPLETED']);
    const all = await eventTypes(cid);
    for (const e of ['PATIENT:PATIENT_JOINED', 'DOCTOR:DOCTOR_JOINED', 'DOCTOR:DOCTOR_ADMITTED', 'DOCTOR:CALL_STARTED', 'PATIENT:PATIENT_LEFT', 'DOCTOR:CALL_ENDED']) assert.ok(all.includes(e), e);
    assert.ok((await kinds(p.user.id)).includes('consultation.ended'));
    assert.equal((await join(p, a)).body.error.code, 'CONSULTATION_ENDED');
    assert.equal((await act(d, cid, 'end')).status, 409);

    // Notes stay editable for 24 h after completion, then lock (existing rule).
    const { saveNote } = await import('../../../apps/api/src/modules/consultations/consultation.service.js');
    await assert.rejects(saveNote({ consultationId: cid, actorUserId: d.user.id, fields: { advice: 'late' }, now: new Date(done.completedAt.getTime() + 25 * 3_600_000) }), (e) => e.status === 423);
  });

  test('doctor rejects: the patient stays waiting-capable, nothing is completed or cancelled; rejoin works', async () => {
    const { p, d, a } = await booking();
    const dj = await join(d, a);
    const cid = dj.body.data.consultation.id;
    assert.equal((await act(d, cid, 'admit')).body.error.code, 'PATIENT_NOT_WAITING', 'nobody to admit yet');
    await join(p, a);
    const rejected = await act(d, cid, 'reject');
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.data.admission, 'REJECTED');
    assert.equal(rejected.body.data.status, 'WAITING');
    assert.equal((await prisma.appointment.findUnique({ where: { id: a.id } })).status, 'WAITING');
    assert.ok((await eventTypes(cid)).includes('DOCTOR:DOCTOR_REJECTED'));
    assert.ok((await kinds(p.user.id)).includes('consultation.rejected'));
    assert.equal((await state(p, cid)).body.data.admission, 'REJECTED', 'the patient is told clearly');
    assert.equal((await act(p, cid, 'reject')).status, 403);
    assert.equal((await act(d, cid, 'end')).status, 409, 'a call that never started cannot be ended');
    assert.equal((await join(p, a)).body.data.consultation.admission, 'WAITING', 'the patient may wait again');
    assert.equal((await act(d, cid, 'admit')).status, 200);
  });

  /* ------------------------------------------------------------ authorization & eligibility */

  test('only the own patient and the assigned, active doctor can join or read', async () => {
    const { p, d, a } = await booking();
    const stranger = await account('PATIENT');
    const otherDoctor = await account('DOCTOR');
    assert.equal((await join(stranger, a)).status, 404);
    assert.equal((await join(otherDoctor, a)).status, 404);
    const cid = (await join(p, a)).body.data.consultation.id;
    for (const who of [stranger, otherDoctor]) {
      assert.equal((await state(who, cid)).status, 404);
      for (const action of ['admit', 'reject', 'leave', 'end', 'ticket']) assert.equal((await act(who, cid, action)).status, 404, action);
    }
    assert.equal((await api('POST', `/api/v1/consultations/${a.id}/join`)).status, 401);
    assert.equal((await api('POST', `/api/v1/consultations/${a.id}/join`, { token: p.token, client: null })).status, 403, 'CSRF header required');
    const admin = await account('ADMIN');
    assert.equal((await join(admin, a)).status, 403);

    for (const change of [{ verificationStatus: 'UNDER_REVIEW' }, { accountStatus: 'SUSPENDED' }]) {
      await prisma.doctorProfile.update({ where: { id: d.profile.id }, data: change });
      const res = await join(d, a);
      assert.equal(res.status, 403, JSON.stringify(change));
      // authenticate() may already refuse the DOCTOR role (ROLE_UNAVAILABLE); otherwise the consultation check does.
      assert.ok(['DOCTOR_NOT_ACTIVE', 'ROLE_UNAVAILABLE'].includes(res.body.error.code), res.body.error.code);
      assert.equal((await act(d, cid, 'admit')).status, 403);
      await prisma.doctorProfile.update({ where: { id: d.profile.id }, data: { verificationStatus: 'VERIFIED', accountStatus: 'ACTIVE' } });
    }
  });

  test('cancelled, unpaid, refunded, too early and too late appointments cannot be joined', async () => {
    const cases = [
      [{ status: 'CANCELLED' }, 'CONSULTATION_NOT_JOINABLE'],
      [{ status: 'PENDING_PAYMENT', payment: null }, 'CONSULTATION_NOT_JOINABLE'],
      [{ payment: null }, 'CONSULTATION_NOT_PAID'],
      [{ payment: 'PENDING' }, 'CONSULTATION_NOT_PAID'],
      [{ payment: 'FAILED' }, 'CONSULTATION_NOT_PAID'],
      [{ startInMin: 11 }, 'CONSULTATION_TOO_EARLY'],
      [{ startInMin: -46 }, 'CONSULTATION_TOO_LATE'],
    ];
    for (const [opts, code] of cases) {
      const { p, d, a } = await booking(opts);
      for (const who of [p, d]) {
        const res = await join(who, a);
        assert.equal(res.status, 409, `${JSON.stringify(opts)} ${res.status}`);
        assert.equal(res.body.error.code, code, JSON.stringify(opts));
      }
      assert.equal(await prisma.consultation.count({ where: { appointmentId: a.id } }), 0, 'nothing created');
    }
    const early = await booking({ startInMin: 11 });
    const res = await join(early.p, early.a);
    assert.equal(res.body.error.details.opensAt, new Date(early.a.startAtUtc.getTime() - 10 * MIN).toISOString());

    const refunded = await booking();
    await prisma.refund.create({ data: { paymentId: refunded.pay.id, appointmentId: refunded.a.id, amount: '20.00', currency: 'USD', reason: 'test' } });
    assert.equal((await join(refunded.p, refunded.a)).body.error.code, 'CONSULTATION_NOT_JOINABLE');

    // Exact window boundaries through the service (server clock injected).
    const b = await booking({ startInMin: 60 });
    const auth = { user: { id: b.p.user.id }, activeRole: 'PATIENT' };
    const opens = new Date(b.a.startAtUtc.getTime() - 10 * MIN);
    const closes = new Date(b.a.endAtUtc.getTime() + 15 * MIN);
    await assert.rejects(calls.join(auth, b.a.id, new Date(opens.getTime() - 1000)), (e) => e.code === 'CONSULTATION_TOO_EARLY');
    assert.equal((await calls.join(auth, b.a.id, opens)).consultation.admission, 'WAITING');
    assert.equal((await calls.join(auth, b.a.id, closes)).consultation.admission, 'WAITING');
    await assert.rejects(calls.join(auth, b.a.id, new Date(closes.getTime() + 1000)), (e) => e.code === 'CONSULTATION_TOO_LATE');

    // Appointment pages show the same eligibility.
    const detail = await api('GET', `/api/v1/appointments/${early.a.id}`, { token: early.p.token });
    assert.equal(detail.body.data.actions.join.allowed, false);
    assert.equal(detail.body.data.actions.join.blocker, 'TOO_EARLY');
    const live = await booking();
    assert.equal((await api('GET', `/api/v1/doctors/me/appointments/${live.a.id}`, { token: live.d.token })).body.data.actions.join.allowed, true);
  });

  test('concurrent joins create exactly one consultation', async () => {
    const { p, d, a } = await booking();
    const results = await Promise.all([join(p, a), join(p, a), join(d, a), join(p, a), join(d, a)]);
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200, 200]);
    assert.equal(new Set(results.map((r) => r.body.data.consultation.id)).size, 1);
    assert.equal(await prisma.consultation.count({ where: { appointmentId: a.id } }), 1);
    assert.equal((await prisma.appointmentStatusHistory.findMany({ where: { appointmentId: a.id, toStatus: 'WAITING' } })).length, 1);
    assert.equal((await prisma.notification.findMany({ where: { userId: d.user.id, eventKey: { startsWith: 'consultation.waiting:' } } })).length, 1);
  });

  /* ------------------------------------------------------------ signaling security */

  test('signaling: tickets, origins, URLs, room isolation, replacement, validation and size limits', async () => {
    const one = await booking();
    const two = await booking();
    const p1 = (await join(one.p, one.a)).body.data;
    const d1 = (await join(one.d, one.a)).body.data;
    const p2 = (await join(two.p, two.a)).body.data;
    const cid1 = p1.consultation.id;

    // No ticket or token in the URL; foreign browser origins refused; unknown paths refused.
    await assert.rejects(connect({ path: `/api/v1/consultations/signal?ticket=${p1.signaling.ticket}` }).opened, /400/);
    await assert.rejects(connect({ origin: 'https://evil.example' }).opened, /403/);
    await assert.rejects(connect({ path: '/api/v1/other' }).opened, /404/);

    // First message must be a valid auth; garbage / unknown / expired tickets are refused.
    const garbage = connect({});
    await garbage.opened;
    garbage.send({ type: 'offer', sdp: SDP, session: 'session_aaaa1111' });
    assert.equal(await garbage.closed, 4001);
    const expired = tickets.issueTicket({ userId: one.p.user.id, role: 'PATIENT', consultationId: cid1 }, Date.now() - 61_000);
    const late = connect({});
    await late.opened;
    late.send({ type: 'auth', ticket: expired.ticket });
    assert.equal(await late.closed, 4001, 'expired ticket');

    // A ticket bound to someone who is not this consultation's participant (third person) is refused.
    const stranger = await account('PATIENT');
    const forged = tickets.issueTicket({ userId: stranger.user.id, role: 'PATIENT', consultationId: cid1 });
    const third = connect({});
    await third.opened;
    third.send({ type: 'auth', ticket: forged.ticket });
    assert.equal(await third.closed, 4003);
    const wrongRole = tickets.issueTicket({ userId: one.p.user.id, role: 'DOCTOR', consultationId: cid1 });
    const wr = connect({});
    await wr.opened;
    wr.send({ type: 'auth', ticket: wrongRole.ticket });
    assert.equal(await wr.closed, 4003, 'role binding');

    // Allowed origin works; rooms are isolated.
    const a = connect({ ticket: p1.signaling.ticket, origin: 'http://allowed.test' });
    const dA = connect({ ticket: d1.signaling.ticket });
    const b = connect({ ticket: p2.signaling.ticket });
    await Promise.all([a.ready, dA.ready, b.ready]);
    await calls.admit({ user: { id: one.d.user.id }, activeRole: 'DOCTOR' }, cid1);
    await dA.waitFor((m) => m.type === 'negotiate');
    dA.send({ type: 'offer', sdp: SDP, session: 'session_bbbb2222' });
    await a.waitFor((m) => m.type === 'offer');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(b.messages.filter((m) => ['offer', 'presence'].includes(m.type) && m.type === 'offer').length, 0, 'other room receives nothing');

    // Invalid messages are answered with an error; a second socket for the same participant replaces the first.
    a.send({ type: 'join-room', consultationId: two.a.id });
    assert.equal((await a.waitFor((m) => m.type === 'error' && m.code === 'INVALID_MESSAGE')).code, 'INVALID_MESSAGE');
    a.ws.send('not json');
    const fresh = (await act(one.p, cid1, 'ticket')).body.data.signaling.ticket;
    const a2 = connect({ ticket: fresh });
    await a2.ready;
    assert.equal(await a.closed, 4009, 'replaced by the newer connection');

    // Oversized frames close the socket (64 KB limit).
    a2.ws.send(JSON.stringify({ type: 'offer', sdp: `v=0${'x'.repeat(70 * 1024)}`, session: 'session_bbbb2222' }));
    assert.equal(await a2.closed, 1009);

    // Rate limit: a flood is cut off.
    const fresh2 = (await act(one.p, cid1, 'ticket')).body.data.signaling.ticket;
    const flood = connect({ ticket: fresh2 });
    await flood.ready;
    for (let i = 0; i < 400 && flood.ws.readyState === 1; i += 1) flood.send({ type: 'ping' });
    assert.equal(await flood.closed, 4008);
  });
});
