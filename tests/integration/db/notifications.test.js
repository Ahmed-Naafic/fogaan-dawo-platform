// Notifications, Web Push and appointment reminders — real HTTP API + services against an isolated
// per-run schema, with a local fake push service. No real push service or external user is contacted.
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';
import { startFakePushService } from '../../support/fakePushService.js';

const require = createRequire(import.meta.url);
const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';
const HOUR = 3_600_000;
const MIN = 60_000;
const WALLET_OK = '+252615551234';

describe('notifications, push and reminders (Neon, isolated schema, fake push)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let server;
  let base;
  let hashPassword;
  let push;
  let svc;
  let reminders;
  let events;
  let vapid;
  let seq = 0;

  before(async () => {
    process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
    process.env.BCRYPT_ROUNDS = '10';
    process.env.COOKIE_SECURE = 'false';
    process.env.BOOKING_RATE_LIMIT_MAX = '10000';
    // Blank (not delete): the Prisma client reloads the project .env for missing variables.
    for (const k of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'PUSH_TEST_ALLOWED_ORIGINS']) process.env[k] = '';
    db = await setupTestDatabase();
    prisma = db.prisma;
    ctx = await baseData(prisma);
    ({ hashPassword } = await import('../../../apps/api/src/utils/password.js'));
    svc = await import('../../../apps/api/src/modules/notifications/notification.service.js');
    reminders = await import('../../../apps/api/src/modules/notifications/reminder.service.js');
    events = await import('../../../apps/api/src/modules/notifications/notification.events.js');
    const { createApp } = await import('../../../apps/api/src/app.js');
    server = createApp({ authRateLimit: { limit: 10_000 } }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
    push = await startFakePushService();
    vapid = require('web-push').generateVAPIDKeys();
  });

  after(async () => {
    for (const k of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'PUSH_TEST_ALLOWED_ORIGINS']) delete process.env[k];
    await push?.close();
    await new Promise((r) => (server ? server.close(r) : r()));
    await db?.teardown();
  });

  const enablePushConfig = () =>
    Object.assign(process.env, { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:push-test@fogaandawo.test', PUSH_TEST_ALLOWED_ORIGINS: push.origin });

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
  const login = async (email, role) => (await api('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD, ...(role ? { role } : {}) } })).body.data.accessToken;
  async function account(roles, extra = {}) {
    const email = `n-${uniq()}@example.test`;
    const user = await prisma.user.create({ data: { email, fullName: extra.fullName ?? `Person ${uniq()}`, timeZone: extra.timeZone ?? 'Africa/Mogadishu', preferredLanguage: extra.lang ?? 'en', passwordHash: await hashPassword(PASSWORD), roles: { create: roles.map((r) => ({ roleId: ctx.roles[r].id })) } } });
    if (roles.includes('PATIENT')) await prisma.patientProfile.create({ data: { userId: user.id } });
    return { user, email, token: roles[0] === 'DOCTOR' ? null : await login(email, roles[0]) };
  }
  let doctor;
  async function theDoctor() {
    if (doctor) return doctor;
    const d = await account(['DOCTOR'], { fullName: 'Dr. Hodan Notify' });
    const profile = await prisma.doctorProfile.create({ data: { userId: d.user.id, specialtyId: ctx.specialty.id, licenceNumber: `L-${uniq()}`, licenceCountry: 'Somalia', consultationFee: '20.00', verificationStatus: 'VERIFIED', verifiedAt: new Date() } });
    doctor = { ...d, profile, token: await login(d.email, 'DOCTOR') };
    return doctor;
  }
  let slotSeq = 0;
  async function slot(hours) {
    const d = await theDoctor();
    slotSeq += 1;
    const startAtUtc = new Date(Date.now() + hours * HOUR + slotSeq * 45 * MIN);
    return prisma.availabilitySlot.create({ data: { doctorId: d.profile.id, startAtUtc, endAtUtc: new Date(startAtUtc.getTime() + 30 * MIN), timeZoneSnapshot: 'Africa/Mogadishu' } });
  }
  async function confirmed(patient, hours = 48) {
    const s = await slot(hours);
    const booked = await api('POST', '/api/v1/appointments', { token: patient.token, body: { slotId: s.id } });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));
    const paid = await fetch(`${base}/api/v1/appointments/${booked.body.data.id}/payments`, {
      method: 'POST',
      headers: { 'x-fogaan-client': 'native', 'content-type': 'application/json', authorization: `Bearer ${patient.token}`, 'idempotency-key': randomUUID() },
      body: JSON.stringify({ provider: 'EVC_PLUS', wallet: WALLET_OK }),
    });
    assert.equal(paid.status, 200);
    return prisma.appointment.findUniqueOrThrow({ where: { id: booked.body.data.id } });
  }
  const kindsOf = async (userId) => (await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } })).map((n) => n.data?.kind);
  const list = (token, q = '') => api('GET', `/api/v1/notifications${q}`, { token });

  /* -------------------------------------------------------------- events */

  test('booking, payment, cancellation and refund events create the right notifications (backend only)', async () => {
    const p = await account(['PATIENT'], { fullName: 'Amina Notify' });
    const a = await confirmed(p);
    const d = await theDoctor();
    assert.deepEqual(await kindsOf(p.user.id), ['appointment.booked', 'payment.confirmed']);
    assert.ok((await kindsOf(d.user.id)).includes('appointment.new'));

    const res = await list(p.token, '?lang=en');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.unreadCount, 2);
    const confirmedItem = res.body.data.items.find((i) => i.kind === 'payment.confirmed');
    assert.equal(confirmedItem.title, 'Payment confirmed');
    assert.match(confirmedItem.body, /\$20\.00/);
    assert.match(confirmedItem.body, /Dr\. Hodan Notify/);
    assert.equal(confirmedItem.url, `/patient/appointments/${a.id}`);
    const so = await list(p.token, '?lang=so');
    assert.equal(so.body.data.items.find((i) => i.kind === 'payment.confirmed').title, 'Lacag-bixinta waa la xaqiijiyay', 'rendered in Somali on request');

    // Doctor cancels a paid appointment → patient told (with refund), admins told a refund is waiting.
    const admin = await account(['ADMIN']);
    const cancel = await api('POST', `/api/v1/doctors/me/appointments/${a.id}/cancel`, { token: d.token, body: { reason: 'Private note: patient diagnosis XYZ' } });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    const cancelled = await prisma.notification.findFirst({ where: { userId: p.user.id, eventKey: `appointment.cancelled:${a.id}` } });
    assert.ok(cancelled.data.params.refund);
    assert.ok(!JSON.stringify(cancelled).includes('XYZ'), 'cancellation reasons never go into notifications');
    assert.ok((await kindsOf(admin.user.id)).includes('admin.refund_requested'));
    assert.ok(!(await kindsOf(d.user.id)).includes('appointment.cancelled'), 'the doctor who cancelled is not notified');

    // Admin processes the refund → patient told it completed.
    const refund = await prisma.refund.findFirst({ where: { appointmentId: a.id } });
    const processed = await api('POST', `/api/v1/admin/finance/refunds/${refund.id}/process`, { token: admin.token, body: {} });
    assert.equal(processed.status, 200, JSON.stringify(processed.body));
    assert.ok((await kindsOf(p.user.id)).includes('refund.completed'));
  });

  test('the same event never produces two notifications (event key)', async () => {
    const p = await account(['PATIENT']);
    const a = await confirmed(p);
    const before = await prisma.notification.count({ where: { userId: p.user.id } });
    await events.paymentConfirmed(prisma, { appointmentId: a.id, paymentId: (await prisma.payment.findFirst({ where: { appointmentId: a.id } })).id, amount: '20.00' });
    await events.appointmentReserved(prisma, a.id);
    assert.equal(await prisma.notification.count({ where: { userId: p.user.id } }), before);
    await assert.rejects(prisma.notification.create({ data: { userId: p.user.id, type: 'SYSTEM', title: 'x', body: 'y', eventKey: `appointment.booked:${a.id}` } }), /Unique constraint/);
  });

  test('doctor application, decisions, suspension and admin events reach the right roles', async () => {
    const admin = await account(['ADMIN']);
    const doc = await account(['PATIENT']);
    await events.applicationSubmitted(prisma, { requestId: randomUUID(), doctorId: randomUUID(), applicantName: 'Dr. Applicant', applicantUserId: doc.user.id });
    const adminItems = (await list(admin.token)).body.data.items;
    assert.ok(adminItems.some((i) => i.kind === 'application.submitted' && i.body.includes('Dr. Applicant') && i.url.startsWith('/admin/verification')));
    assert.equal((await kindsOf(doc.user.id)).includes('application.submitted'), false, 'not sent to the applicant');
    for (const decision of ['START_REVIEW', 'APPROVE', 'REJECT']) await events.applicationDecided(prisma, { decision, requestId: randomUUID(), doctorId: randomUUID(), doctorUserId: doc.user.id });
    assert.deepEqual((await kindsOf(doc.user.id)).slice(-3), ['application.review_started', 'application.approved', 'application.rejected']);
    await events.doctorSuspended(prisma, { doctorId: randomUUID(), doctorUserId: doc.user.id, at: new Date() });
    assert.ok((await kindsOf(doc.user.id)).includes('account.doctor_suspended'));
  });

  /* ------------------------------------------------------ inbox & ownership */

  test('ownership: users see and change only their own notifications (patient, doctor, admin)', async () => {
    const a = await account(['PATIENT']);
    const b = await account(['ADMIN']);
    await svc.notify(prisma, { kind: 'refund.completed', recipients: [{ userId: a.user.id, role: 'PATIENT' }], params: { refundId: 'r1', amount: '5.00' }, eventKey: `test.own:${uniq()}` });
    const mine = await prisma.notification.findFirst({ where: { userId: a.user.id } });
    for (const [method, path, body] of [['PATCH', `/api/v1/notifications/${mine.id}`, { read: true }], ['DELETE', `/api/v1/notifications/${mine.id}`]]) {
      const res = await api(method, path, { token: b.token, body });
      assert.equal(res.status, 404, `${method} by another user`);
    }
    assert.equal((await list(b.token)).body.data.items.some((i) => i.id === mine.id), false);
    assert.equal((await prisma.notification.findUnique({ where: { id: mine.id } })).readAt, null, 'unchanged');
    assert.equal((await api('GET', '/api/v1/notifications')).status, 401);
    assert.equal((await api('PATCH', `/api/v1/notifications/${mine.id}`, { token: a.token, body: { read: true }, client: null })).status, 403, 'CSRF header required');
    assert.equal((await api('PATCH', '/api/v1/notifications/not-a-uuid', { token: a.token, body: { read: true } })).status, 400);
  });

  test('read / unread / read-all / delete, unread count and keyset pagination', async () => {
    const p = await account(['PATIENT']);
    for (let i = 0; i < 25; i += 1) {
      await svc.notify(prisma, { kind: 'refund.completed', recipients: [{ userId: p.user.id, role: 'PATIENT' }], params: { refundId: `r${i}`, amount: `${i}.00` }, eventKey: `test.page:${p.user.id}:${i}` });
    }
    const first = await list(p.token, '?limit=10');
    assert.equal(first.body.data.items.length, 10);
    assert.equal(first.body.data.unreadCount, 25);
    const second = await list(p.token, `?limit=10&cursor=${first.body.data.nextCursor}`);
    const third = await list(p.token, `?limit=10&cursor=${second.body.data.nextCursor}`);
    const ids = [...first.body.data.items, ...second.body.data.items, ...third.body.data.items].map((i) => i.id);
    assert.equal(new Set(ids).size, 25, 'no gaps or repeats across pages');
    assert.equal(third.body.data.nextCursor, null);

    const id = ids[0];
    assert.equal((await api('PATCH', `/api/v1/notifications/${id}`, { token: p.token, body: { read: true } })).body.data.unreadCount, 24);
    assert.equal((await list(p.token, '?unread=true&limit=50')).body.data.items.length, 24);
    assert.equal((await api('PATCH', `/api/v1/notifications/${id}`, { token: p.token, body: { read: false } })).body.data.unreadCount, 25, 'mark as unread');
    assert.equal((await api('POST', '/api/v1/notifications/read-all', { token: p.token })).body.data.unreadCount, 0);
    const del = await api('DELETE', `/api/v1/notifications/${id}`, { token: p.token });
    assert.equal(del.status, 200);
    assert.equal(await prisma.notification.count({ where: { userId: p.user.id } }), 24);
    assert.equal((await api('DELETE', `/api/v1/notifications/${id}`, { token: p.token })).status, 404);
  });

  test('real-time: the SSE stream delivers a new notification (rendered for the reader) and unread syncs', async () => {
    const p = await account(['PATIENT'], { fullName: 'Stream Patient' });
    const controller = new AbortController();
    const res = await fetch(`${base}/api/v1/notifications/stream?lang=so&tz=Africa/Mogadishu`, { headers: { authorization: `Bearer ${p.token}` }, signal: controller.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const waitFor = async (needle) => {
      const end = Date.now() + 10_000;
      while (!text.includes(needle) && Date.now() < end) {
        const { value, done } = await Promise.race([reader.read(), new Promise((r) => setTimeout(() => r({ value: undefined, done: false }), 500))]);
        if (done) break;
        if (value) text += decoder.decode(value, { stream: true });
      }
      return text.includes(needle);
    };
    assert.ok(await waitFor('event: ready'));
    await svc.notify(prisma, { kind: 'refund.completed', recipients: [{ userId: p.user.id, role: 'PATIENT' }], params: { refundId: 'rt', amount: '7.00' }, eventKey: `test.rt:${uniq()}` });
    await svc.dispatchPendingNotifications();
    assert.ok(await waitFor('event: notification'), 'notification event received');
    const payload = JSON.parse(text.split('event: notification\ndata: ')[1].split('\n')[0]);
    assert.equal(payload.item.title, 'Lacag-celinta waa dhammaatay', 'rendered in the stream language');
    assert.equal(payload.unreadCount, 1);
    await api('POST', '/api/v1/notifications/read-all', { token: p.token });
    assert.ok(await waitFor('event: sync'), 'other tabs are told the unread count changed');
    controller.abort();
  });

  /* ------------------------------------------------------------------ push */

  test('push: unavailable without VAPID (in-app still works); subscription validation; multiple devices', async () => {
    const p = await account(['PATIENT']);
    const sub = push.newSubscription();
    const unavailable = await api('POST', '/api/v1/notifications/push-subscriptions', { token: p.token, body: sub });
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.body.error.code, 'PUSH_UNAVAILABLE');
    assert.equal((await api('GET', '/api/v1/notifications/preferences', { token: p.token })).body.data.push.available, false);

    enablePushConfig();
    const prefs = (await api('GET', '/api/v1/notifications/preferences', { token: p.token })).body.data;
    assert.deepEqual({ inApp: prefs.inAppEnabled, push: prefs.pushEnabled, reminders: prefs.remindersEnabled }, { inApp: true, push: false, reminders: true }, 'defaults');
    assert.equal(prefs.push.publicKey, vapid.publicKey, 'only the PUBLIC key is exposed');
    assert.ok(!JSON.stringify(prefs).includes(vapid.privateKey));

    const evil = { ...push.newSubscription(), endpoint: 'https://169.254.169.254/latest/meta-data' };
    const refused = await api('POST', '/api/v1/notifications/push-subscriptions', { token: p.token, body: evil });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error.code, 'PUSH_ENDPOINT_NOT_ALLOWED', 'no SSRF to arbitrary hosts');
    assert.equal((await api('POST', '/api/v1/notifications/push-subscriptions', { token: p.token, body: { ...sub, keys: { p256dh: 'short', auth: 'x' } } })).status, 400);
    assert.equal((await api('POST', '/api/v1/notifications/push-subscriptions', { token: p.token, body: sub, client: null })).status, 403);

    const phone = push.newSubscription();
    assert.equal((await api('POST', '/api/v1/notifications/push-subscriptions', { token: p.token, body: sub })).status, 201);
    const two = await api('POST', '/api/v1/notifications/push-subscriptions', { token: p.token, body: phone });
    assert.equal(two.body.data.push.devices, 2);
    assert.equal(two.body.data.pushEnabled, true);

    // Same browser signs in to another account → the endpoint moves (never delivers to the old account).
    const other = await account(['PATIENT']);
    await api('POST', '/api/v1/notifications/push-subscriptions', { token: other.token, body: phone });
    assert.equal(await prisma.pushSubscription.count({ where: { userId: p.user.id } }), 1);
    assert.equal((await prisma.pushSubscription.findUnique({ where: { endpoint: phone.endpoint } })).userId, other.user.id);
  });

  test('push delivery: VAPID-signed encrypted requests to every device; 410 Gone removes the subscription; disabled push sends nothing', async () => {
    enablePushConfig();
    const p = await account(['PATIENT'], { lang: 'so' });
    const laptop = push.newSubscription();
    const phone = push.newSubscription();
    for (const s of [laptop, phone]) await api('POST', '/api/v1/notifications/push-subscriptions', { token: p.token, body: s });

    await svc.notify(prisma, { kind: 'refund.completed', recipients: [{ userId: p.user.id, role: 'PATIENT' }], params: { refundId: 'p1', amount: '9.00' }, eventKey: `test.push:${uniq()}` });
    await svc.dispatchPendingNotifications();
    for (const s of [laptop, phone]) {
      const [req] = push.to(s.endpoint);
      assert.ok(req, 'delivered to each device');
      assert.match(req.headers.authorization, new RegExp(`^vapid t=.+, k=${vapid.publicKey}$`), 'VAPID (RFC 8292)');
      assert.equal(req.headers['content-encoding'], 'aes128gcm', 'encrypted (RFC 8291)');
      assert.ok(Number(req.headers.ttl) > 0);
      assert.ok(req.size > 0);
    }

    push.respondWith(phone.endpoint, 410);
    await svc.notify(prisma, { kind: 'refund.completed', recipients: [{ userId: p.user.id, role: 'PATIENT' }], params: { refundId: 'p2', amount: '9.00' }, eventKey: `test.push:${uniq()}` });
    await svc.dispatchPendingNotifications();
    assert.equal(await prisma.pushSubscription.count({ where: { endpoint: phone.endpoint } }), 0, 'expired subscription cleaned up');
    assert.equal(await prisma.pushSubscription.count({ where: { endpoint: laptop.endpoint } }), 1);

    await api('PUT', '/api/v1/notifications/preferences', { token: p.token, body: { pushEnabled: false } });
    const before = push.to(laptop.endpoint).length;
    await svc.notify(prisma, { kind: 'refund.completed', recipients: [{ userId: p.user.id, role: 'PATIENT' }], params: { refundId: 'p3', amount: '9.00' }, eventKey: `test.push:${uniq()}` });
    await svc.dispatchPendingNotifications();
    assert.equal(push.to(laptop.endpoint).length, before, 'no push when disabled');
    assert.equal((await list(p.token)).body.data.unreadCount, 3, 'in-app notifications keep working');

    const removed = await fetch(`${base}/api/v1/notifications/push-subscriptions`, { method: 'DELETE', headers: { 'x-fogaan-client': 'native', 'content-type': 'application/json', authorization: `Bearer ${p.token}` }, body: JSON.stringify({ endpoint: laptop.endpoint }) });
    assert.equal(removed.status, 200);
    assert.equal(await prisma.pushSubscription.count({ where: { userId: p.user.id } }), 0);
  });

  test('push payloads carry only title, short text, an in-app link and a tag — in the user language', async () => {
    const p = await account(['PATIENT'], { lang: 'so' });
    const a = await confirmed(p);
    await prisma.appointment.update({ where: { id: a.id }, data: { reason: 'Chest pain and diabetes history' } });
    const row = await prisma.notification.findFirst({ where: { userId: p.user.id, eventKey: { startsWith: 'payment.confirmed:' } }, include: { user: { select: { preferredLanguage: true, timeZone: true, notificationPreference: true } } } });
    const payload = svc.pushPayloadFor(row);
    assert.deepEqual(Object.keys(payload).sort(), ['body', 'notificationId', 'tag', 'title', 'url']);
    assert.equal(payload.title, 'Lacag-bixinta waa la xaqiijiyay');
    assert.ok(payload.url.startsWith('/'));
    assert.ok(!/diabetes|chest/i.test(JSON.stringify(payload)), 'no medical details');
  });

  /* ------------------------------------------------------------- reminders */

  const remindersOf = (appointmentId) => prisma.appointmentReminder.findMany({ where: { appointmentId }, orderBy: [{ dueAt: 'asc' }, { userId: 'asc' }] });

  test('reminders: planned for patient and doctor at 24 h / 1 h / 10 min (UTC), sent once each, times in each user’s zone', async () => {
    const p = await account(['PATIENT'], { timeZone: 'America/New_York' });
    const a = await confirmed(p, 40);
    const S = a.startAtUtc.getTime();
    await reminders.planReminders(new Date(S - 24 * HOUR - 30 * MIN));
    const rows = await remindersOf(a.id);
    assert.equal(rows.length, 6, '3 kinds × patient + doctor');
    for (const r of rows) {
      const minutes = { BEFORE_24H: 1440, BEFORE_1H: 60, BEFORE_10M: 10 }[r.kind];
      assert.equal(r.dueAt.getTime(), S - minutes * MIN, `${r.kind} due time (UTC)`);
    }
    await reminders.planReminders(new Date(S - 24 * HOUR - 20 * MIN));
    assert.equal((await remindersOf(a.id)).length, 6, 'planning again adds nothing');

    const at24 = new Date(S - 24 * HOUR + MIN);
    await reminders.dispatchDueReminders(at24);
    await reminders.dispatchDueReminders(at24);
    const sent24 = await prisma.notification.findMany({ where: { eventKey: `reminder.BEFORE_24H:${a.id}` } });
    assert.equal(sent24.length, 2, 'one per participant, never twice');

    await reminders.dispatchDueReminders(new Date(S - 59 * MIN));
    const oneHour = await prisma.notification.findMany({ where: { eventKey: `reminder.BEFORE_1H:${a.id}` }, include: { user: true } });
    assert.equal(oneHour.length, 2);
    const fmt = (tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(a.startAtUtc);
    const patientNote = oneHour.find((n) => n.userId === p.user.id);
    assert.ok(patientNote.body.includes(fmt('America/New_York')), `patient sees New York time: ${patientNote.body}`);
    const doctorNote = oneHour.find((n) => n.userId !== p.user.id);
    assert.ok(doctorNote.body.includes(fmt('Africa/Mogadishu')), `doctor sees Mogadishu time: ${doctorNote.body}`);
    assert.equal(doctorNote.data.params.role, 'DOCTOR');

    // 10-minute reminder missed by more than its grace window (e.g. API was down) → skipped, not sent late.
    await reminders.dispatchDueReminders(new Date(S - 2 * MIN));
    assert.equal(await prisma.notification.count({ where: { eventKey: `reminder.BEFORE_10M:${a.id}` } }), 0);
    assert.ok((await remindersOf(a.id)).filter((r) => r.kind === 'BEFORE_10M').every((r) => r.status === 'SKIPPED'));
  });

  test('reminders: cancellation stops them; the status is re-checked right before sending; reschedule re-plans', async () => {
    const p = await account(['PATIENT']);
    const a = await confirmed(p, 60);
    const S = a.startAtUtc.getTime();
    await reminders.planReminders(new Date(S - 24 * HOUR - 10 * MIN));
    const cancel = await api('POST', `/api/v1/appointments/${a.id}/cancel`, { token: p.token, body: {} });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.ok((await remindersOf(a.id)).every((r) => r.status === 'CANCELLED'), 'cancelled with the appointment');
    await reminders.dispatchDueReminders(new Date(S - 5 * MIN));
    assert.equal(await prisma.notification.count({ where: { eventKey: { startsWith: 'reminder.' }, data: { path: ['params', 'appointmentId'], equals: a.id } } }), 0, 'never for a cancelled appointment');

    // Status changed behind the planner's back (e.g. by another process): re-check at send time.
    const b = await confirmed(p, 70);
    const SB = b.startAtUtc.getTime();
    await reminders.planReminders(new Date(SB - 24 * HOUR - 10 * MIN));
    await prisma.appointment.update({ where: { id: b.id }, data: { status: 'NO_SHOW' } });
    const out = await reminders.dispatchDueReminders(new Date(SB - 24 * HOUR + MIN));
    assert.ok(out.cancelled >= 2);
    assert.equal(await prisma.notification.count({ where: { eventKey: `reminder.BEFORE_24H:${b.id}` } }), 0);

    // Reschedule: old reminders cancelled, the new appointment is planned on its own times.
    const c = await confirmed(p, 80);
    await reminders.planReminders(new Date(c.startAtUtc.getTime() - 24 * HOUR - 10 * MIN));
    const target = await slot(100);
    const moved = await api('POST', `/api/v1/appointments/${c.id}/reschedule`, { token: p.token, body: { slotId: target.id } });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.ok((await remindersOf(c.id)).every((r) => r.status === 'CANCELLED'));
    const newId = moved.body.data.id;
    const newStart = (await prisma.appointment.findUnique({ where: { id: newId } })).startAtUtc.getTime();
    await reminders.planReminders(new Date(newStart - 24 * HOUR - 10 * MIN));
    const planned = await remindersOf(newId);
    assert.equal(planned.length, 6);
    assert.ok(planned.every((r) => r.status === 'PENDING'));
    assert.ok((await kindsOf(p.user.id)).includes('appointment.rescheduled'));
    assert.ok((await kindsOf((await theDoctor()).user.id)).includes('appointment.rescheduled'));
  });

  test('preferences: reminders off → skipped; optional in-app off → stored as read (badge unaffected); essentials always kept', async () => {
    const p = await account(['PATIENT']);
    const a = await confirmed(p, 90);
    const S = a.startAtUtc.getTime();
    await api('PUT', '/api/v1/notifications/preferences', { token: p.token, body: { remindersEnabled: false } });
    await reminders.planReminders(new Date(S - 24 * HOUR - 10 * MIN));
    await reminders.dispatchDueReminders(new Date(S - 24 * HOUR + MIN));
    assert.equal(await prisma.notification.count({ where: { userId: p.user.id, eventKey: `reminder.BEFORE_24H:${a.id}` } }), 0);

    await api('PUT', '/api/v1/notifications/preferences', { token: p.token, body: { remindersEnabled: true, inAppEnabled: false } });
    await reminders.dispatchDueReminders(new Date(S - 59 * MIN));
    const quiet = await prisma.notification.findFirst({ where: { userId: p.user.id, eventKey: `reminder.BEFORE_1H:${a.id}` } });
    assert.ok(quiet?.readAt, 'optional reminder kept as read');
    await svc.notify(prisma, { kind: 'refund.completed', recipients: [{ userId: p.user.id, role: 'PATIENT' }], params: { refundId: 'e1', amount: '1.00' }, eventKey: `test.essential:${uniq()}` });
    const essential = await prisma.notification.findFirst({ where: { userId: p.user.id, data: { path: ['kind'], equals: 'refund.completed' } } });
    assert.equal(essential.readAt, null, 'essential notifications are unaffected by preferences');
    assert.equal((await api('PUT', '/api/v1/notifications/preferences', { token: p.token, body: {} })).status, 400);
    assert.equal((await api('PUT', '/api/v1/notifications/preferences', { token: p.token, body: { smsEnabled: true } })).status, 400, 'no SMS/email settings exist');
  });
});
