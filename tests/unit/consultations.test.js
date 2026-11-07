// Unit tests: consultation join window, eligibility, admission state, duration, signaling tickets,
// signaling message validation and STUN configuration. No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admissionState, canTransition, durationSeconds, joinAction, joinBlocker, joinWindow } from '../../apps/api/src/modules/consultations/consultation.policy.js';
import { __ticketCount, consumeTicket, issueTicket } from '../../apps/api/src/modules/consultations/consultation.tickets.js';
import { validateSignal } from '../../apps/api/src/modules/consultations/consultation.signaling.js';
import { iceServersFor, parseStunUrls, webrtcConfigProblem } from '../../apps/api/src/config/webrtc.js';

const at = (iso) => new Date(iso);
const appt = (status = 'CONFIRMED') => ({ status, startAtUtc: at('2026-11-10T10:00:00Z'), endAtUtc: at('2026-11-10T10:30:00Z') });
const ok = { paymentStatus: 'SUCCEEDED', refunded: false };

test('join window: opens 10 min before start, closes 15 min after end (inclusive), UTC', () => {
  const w = joinWindow(appt());
  assert.equal(w.opensAt.toISOString(), '2026-11-10T09:50:00.000Z');
  assert.equal(w.closesAt.toISOString(), '2026-11-10T10:45:00.000Z');
  const check = (iso) => joinBlocker({ appointment: appt(), ...ok, now: at(iso) });
  assert.equal(check('2026-11-10T09:49:59Z'), 'TOO_EARLY', 'one second before opening');
  assert.equal(check('2026-11-10T09:50:00Z'), null, 'exactly at opening');
  assert.equal(check('2026-11-10T09:50:01Z'), null, 'one second after opening');
  assert.equal(check('2026-11-10T10:44:59Z'), null, 'one second before closing');
  assert.equal(check('2026-11-10T10:45:00Z'), null, 'exactly at closing');
  assert.equal(check('2026-11-10T10:45:01Z'), 'TOO_LATE', 'one second after closing');
});

test('eligibility: status, payment and refunds are checked before timing', () => {
  const now = at('2026-11-10T10:00:00Z');
  for (const status of ['CONFIRMED', 'WAITING', 'IN_PROGRESS']) assert.equal(joinBlocker({ appointment: appt(status), ...ok, now }), null, status);
  for (const status of ['PENDING_PAYMENT', 'CANCELLED', 'EXPIRED', 'RESCHEDULED', 'NO_SHOW']) assert.equal(joinBlocker({ appointment: appt(status), ...ok, now }), 'NOT_JOINABLE', status);
  assert.equal(joinBlocker({ appointment: appt('COMPLETED'), ...ok, now }), 'ENDED');
  assert.equal(joinBlocker({ appointment: appt(), consultation: { status: 'COMPLETED' }, ...ok, now }), 'ENDED');
  for (const paymentStatus of [null, 'PENDING', 'FAILED', 'CANCELLED']) assert.equal(joinBlocker({ appointment: appt(), paymentStatus, now }), 'NOT_PAID', String(paymentStatus));
  assert.equal(joinBlocker({ appointment: appt(), paymentStatus: 'SUCCEEDED', refunded: true, now }), 'NOT_JOINABLE', 'refunded');
  assert.equal(joinBlocker({ appointment: appt('CANCELLED'), paymentStatus: null, now: at('2026-11-12T00:00:00Z') }), 'NOT_JOINABLE', 'cancelled reported before timing/payment');
  assert.deepEqual(joinAction(appt(), { ...ok, now }), { allowed: true, blocker: null, opensAt: '2026-11-10T09:50:00.000Z', closesAt: '2026-11-10T10:45:00.000Z' });
});

test('duration is whole server seconds, never negative', () => {
  assert.equal(durationSeconds(at('2026-11-10T10:00:00Z'), at('2026-11-10T10:12:34.900Z')), 754);
  assert.equal(durationSeconds(at('2026-11-10T10:00:00Z'), at('2026-11-10T09:59:00Z')), 0);
  assert.equal(durationSeconds(null, at('2026-11-10T10:00:00Z')), null);
});

test('admission state and lifecycle transitions', () => {
  const ev = (...types) => types.map((eventType) => ({ eventType }));
  assert.equal(admissionState(null), 'NOT_JOINED');
  assert.equal(admissionState({ status: 'WAITING' }, ev('DOCTOR_JOINED')), 'NOT_JOINED');
  assert.equal(admissionState({ status: 'WAITING' }, ev('PATIENT_JOINED')), 'WAITING');
  assert.equal(admissionState({ status: 'WAITING' }, ev('PATIENT_JOINED', 'DOCTOR_REJECTED')), 'REJECTED');
  assert.equal(admissionState({ status: 'WAITING' }, ev('PATIENT_JOINED', 'DOCTOR_REJECTED', 'PATIENT_JOINED')), 'WAITING', 'rejoin after rejection');
  assert.equal(admissionState({ status: 'WAITING' }, ev('PATIENT_JOINED', 'PATIENT_LEFT')), 'NOT_JOINED');
  assert.equal(admissionState({ status: 'IN_PROGRESS' }, ev('PATIENT_JOINED', 'PATIENT_LEFT')), 'IN_CALL', 'leaving does not end the call');
  assert.equal(admissionState({ status: 'COMPLETED' }, []), 'ENDED');
  assert.ok(canTransition('WAITING', 'IN_PROGRESS') && canTransition('IN_PROGRESS', 'COMPLETED'));
  assert.ok(!canTransition('WAITING', 'COMPLETED') && !canTransition('COMPLETED', 'IN_PROGRESS') && !canTransition('IN_PROGRESS', 'WAITING'));
});

test('signaling tickets: random, bound, single-use, expire after their lifetime', () => {
  const now = Date.now();
  const a = issueTicket({ userId: 'u1', role: 'PATIENT', consultationId: 'c1' }, now);
  const b = issueTicket({ userId: 'u1', role: 'PATIENT', consultationId: 'c1' }, now);
  assert.notEqual(a.ticket, b.ticket);
  assert.ok(a.ticket.length >= 43, '256-bit');
  assert.equal(a.expiresAt.getTime(), now + 60_000);
  assert.deepEqual(consumeTicket(a.ticket, now + 1000), { userId: 'u1', role: 'PATIENT', consultationId: 'c1' }, 'bound to user, role and consultation');
  assert.equal(consumeTicket(a.ticket, now + 1000), null, 'single use');
  assert.equal(consumeTicket(b.ticket, now + 60_000), null, 'expired at its lifetime');
  assert.equal(consumeTicket(b.ticket, now), null, 'an expired ticket is also deleted');
  const c = issueTicket({ userId: 'u2', role: 'DOCTOR', consultationId: 'c2' }, now);
  assert.equal(consumeTicket(c.ticket, now + 59_999).role, 'DOCTOR');
  for (const bad of [undefined, null, 42, '', 'short', 'x'.repeat(500), `${c.ticket}x`]) assert.equal(consumeTicket(bad, now), null);
  issueTicket({ userId: 'u3', role: 'PATIENT', consultationId: 'c3' }, now);
  issueTicket({ userId: 'u4', role: 'PATIENT', consultationId: 'c4' }, now + 61_000);
  assert.ok(__ticketCount() <= 1, 'expired tickets are swept');
});

test('signaling messages: only valid offer/answer/candidate/media/restart/ping; extra fields dropped', () => {
  const session = 'sess_12345678';
  const sdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n';
  assert.deepEqual(validateSignal(JSON.stringify({ type: 'offer', sdp, session, evil: 'x' })), { type: 'offer', sdp, session });
  assert.deepEqual(validateSignal({ type: 'candidate', session, candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0 }), { type: 'candidate', session, candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0', sdpMLineIndex: 0 });
  assert.equal(validateSignal({ type: 'candidate', session, candidate: '' }).candidate, '', 'end-of-candidates');
  assert.deepEqual(validateSignal({ type: 'media', audio: false, video: true }), { type: 'media', audio: false, video: true });
  for (const bad of [
    'not json',
    '[]',
    'null',
    { type: 'join-room', consultationId: 'other' },
    { type: 'offer', sdp: 'hello', session },
    { type: 'offer', sdp: `v=0${'a'.repeat(40_000)}`, session },
    { type: 'answer', sdp, session: 'bad session!' },
    { type: 'candidate', session, candidate: 'javascript:alert(1)' },
    { type: 'candidate', session, candidate: `candidate:${'1'.repeat(3000)}` },
    { type: 'candidate', session, candidate: 'candidate:1', sdpMLineIndex: -1 },
    { type: 'media', audio: 'yes', video: true },
    { type: 'auth', ticket: 'x'.repeat(200) },
  ]) {
    assert.equal(validateSignal(typeof bad === 'string' ? bad : JSON.stringify(bad)), null, JSON.stringify(bad).slice(0, 60));
  }
});

test('STUN configuration: validated URLs only, default Google STUN, no TURN, no secrets', () => {
  const saved = process.env.WEBRTC_STUN_URLS;
  try {
    delete process.env.WEBRTC_STUN_URLS;
    assert.deepEqual(parseStunUrls().urls, ['stun:stun.l.google.com:19302']);
    process.env.WEBRTC_STUN_URLS = 'stun:stun.l.google.com:19302, stun:stun1.example.org:3478,turn:evil.example:3478,http://x,stun:bad host,stun:a.example:99999';
    const { urls, invalid } = parseStunUrls();
    assert.deepEqual(urls, ['stun:stun.l.google.com:19302', 'stun:stun1.example.org:3478']);
    assert.equal(invalid.length, 4);
    assert.match(webrtcConfigProblem(), /invalid/);
    assert.deepEqual(iceServersFor(), [{ urls }]);
    assert.ok(!JSON.stringify(iceServersFor()).match(/credential|username|turn:/));
    process.env.WEBRTC_STUN_URLS = '';
    assert.deepEqual(iceServersFor(), []);
    assert.match(webrtcConfigProblem(), /same network/);
  } finally {
    if (saved === undefined) delete process.env.WEBRTC_STUN_URLS;
    else process.env.WEBRTC_STUN_URLS = saved;
  }
});
