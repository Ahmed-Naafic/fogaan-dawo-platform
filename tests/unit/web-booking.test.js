// Unit tests: booking screen helpers (server-corrected countdown, status tones, error mapping).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APPOINTMENT_TONE, bookingErrorKey, formatCountdown, ratePercent, remainingMs } from '../../apps/web/src/features/appointments/booking.js';

test('the countdown follows the server clock, not the device clock', () => {
  const receivedAt = 1_000_000;
  const hold = new Date(600_000).toISOString(); // server says: hold ends at t=600s
  const serverTime = new Date(0).toISOString(); // server time at receipt: t=0
  // device clock is 1000 s ahead of the server; 30 s after receipt, 570 s remain
  assert.equal(remainingMs(hold, { serverTime, receivedAt }, receivedAt + 30_000), 570_000);
  assert.equal(remainingMs(hold, { serverTime, receivedAt }, receivedAt + 700_000), 0, 'never negative');
  assert.equal(remainingMs(null, { serverTime, receivedAt }), 0);
  assert.equal(formatCountdown(570_000), '09:30');
  assert.equal(formatCountdown(59_001), '01:00');
  assert.equal(formatCountdown(0), '00:00');
});

test('every appointment status has a tone and a label in both languages', () => {
  const en = JSON.parse(readFileSync(new URL('../../apps/web/src/locales/en.json', import.meta.url), 'utf8'));
  const so = JSON.parse(readFileSync(new URL('../../apps/web/src/locales/so.json', import.meta.url), 'utf8'));
  for (const status of ['PENDING_PAYMENT', 'CONFIRMED', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'RESCHEDULED', 'NO_SHOW']) {
    assert.ok(APPOINTMENT_TONE[status], status);
    assert.equal(typeof en.apptStatus[status], 'string');
    assert.equal(typeof so.apptStatus[status], 'string');
  }
  assert.equal(ratePercent(0.5), '50%');
});

test('booking errors map to translated keys, including the reschedule reason', () => {
  assert.equal(bookingErrorKey({ code: 'SLOT_UNAVAILABLE' }), 'bookingErrors.SLOT_UNAVAILABLE');
  assert.equal(bookingErrorKey({ code: 'RESCHEDULE_NOT_ALLOWED', details: { blocker: 'TOO_LATE' } }), 'bookingErrors.reschedule.TOO_LATE');
  assert.equal(bookingErrorKey({ code: 'WHATEVER' }), 'bookingErrors.GENERIC');
});
