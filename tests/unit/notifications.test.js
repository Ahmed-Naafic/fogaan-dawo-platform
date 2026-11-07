// Unit tests: notification catalog (EN/SO parity, rendering, time zones, privacy), push endpoint allow-list,
// VAPID configuration and reminder timing. No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messageKeys, NOTIFICATION_KINDS, notificationUrl, renderNotification } from '../../apps/api/src/modules/notifications/notification.catalog.js';
import { isAllowedPushEndpoint, pushConfigProblem } from '../../apps/api/src/config/push.js';
import { REMINDERS, reminderDueAt } from '../../apps/api/src/modules/notifications/reminder.service.js';

test('every notification message exists in English and Somali with the same placeholders', () => {
  const en = messageKeys('en');
  assert.deepEqual(messageKeys('so').sort(), [...en].sort());
  for (const kind of Object.keys(NOTIFICATION_KINDS)) {
    if (kind === 'appointment.reminder') continue;
    assert.ok(en.includes(kind), `${kind} has a message`);
  }
  for (const r of REMINDERS) assert.ok(en.includes(`appointment.reminder.${r.kind}`));
  const params = { startAtUtc: '2026-11-10T09:30:00Z', doctor: 'Dr. A', patient: 'B', counterpart: 'C', applicant: 'D', amount: '20.00', reminder: 'BEFORE_1H', refund: true };
  for (const lang of ['en', 'so']) {
    for (const kind of Object.keys(NOTIFICATION_KINDS)) {
      const out = renderNotification({ kind, params }, { lang, timeZone: 'Africa/Mogadishu' });
      assert.ok(out.title && out.body, `${lang} ${kind}`);
      assert.ok(!/\{\w+\}/.test(out.title + out.body), `${lang} ${kind}: no unfilled placeholder`);
    }
  }
});

test('times are rendered in the reader time zone (stored UTC)', () => {
  const n = { kind: 'appointment.reminder', params: { reminder: 'BEFORE_1H', startAtUtc: '2026-11-10T09:30:00Z', counterpart: 'Dr. A' } };
  assert.match(renderNotification(n, { lang: 'en', timeZone: 'Africa/Mogadishu' }).body, /12:30/);
  assert.match(renderNotification(n, { lang: 'en', timeZone: 'America/New_York' }).body, /04:30/);
  assert.match(renderNotification(n, { lang: 'so', timeZone: 'Europe/London' }).body, /09:30/);
  assert.ok(renderNotification(n, { lang: 'xx', timeZone: 'Not/AZone' }).body.length > 0, 'unknown language/zone falls back safely');
});

test('links are internal and role-aware', () => {
  assert.equal(notificationUrl({ kind: 'appointment.reminder', params: { appointmentId: 'a1' }, role: 'DOCTOR' }), '/doctor/appointments/a1');
  assert.equal(notificationUrl({ kind: 'appointment.reminder', params: { appointmentId: 'a1' }, role: 'PATIENT' }), '/patient/appointments/a1');
  assert.equal(notificationUrl({ kind: 'admin.refund_failed', params: {} }), '/admin/finance/refunds');
  for (const kind of Object.keys(NOTIFICATION_KINDS)) assert.ok(notificationUrl({ kind, params: {} }).startsWith('/'));
});

test('push endpoints: only HTTPS push services (no SSRF); VAPID config validated', () => {
  const config = { testOrigins: [] };
  for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-par02p.notify.windows.com/w/?token=x', 'https://web.push.apple.com/QH']) {
    assert.ok(isAllowedPushEndpoint(ok, config), ok);
  }
  for (const bad of ['http://fcm.googleapis.com/x', 'https://169.254.169.254/latest', 'https://localhost/x', 'https://evil.com/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.com/x', 'https://fcm.googleapis.com:8443/x', 'not a url']) {
    assert.equal(isAllowedPushEndpoint(bad, config), false, bad);
  }
  const saved = { ...process.env };
  try {
    delete process.env.VAPID_PUBLIC_KEY;
    assert.match(pushConfigProblem(), /missing VAPID_PUBLIC_KEY/);
    Object.assign(process.env, { VAPID_PUBLIC_KEY: 'x'.repeat(87), VAPID_PRIVATE_KEY: 'y'.repeat(43), VAPID_SUBJECT: 'ftp://x' });
    assert.match(pushConfigProblem(), /VAPID_SUBJECT/);
  } finally {
    for (const k of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test('reminder due times are exact UTC offsets', () => {
  const start = new Date('2026-11-10T09:30:00Z');
  assert.equal(reminderDueAt(start, 'BEFORE_24H').toISOString(), '2026-11-09T09:30:00.000Z');
  assert.equal(reminderDueAt(start, 'BEFORE_1H').toISOString(), '2026-11-10T08:30:00.000Z');
  assert.equal(reminderDueAt(start, 'BEFORE_10M').toISOString(), '2026-11-10T09:20:00.000Z');
});
