// Unit tests: approved cancellation / refund and rescheduling rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancellationPreview, refundAmount, refundRate, rescheduleBlocker } from '../../apps/api/src/modules/appointments/appointment.policy.js';

const now = new Date('2026-11-10T12:00:00Z');
const at = (hours) => new Date(now.getTime() + hours * 3_600_000);

test('patient cancellation: >24 h → 100 %, 2–24 h → 50 %, <2 h → 0 %', () => {
  assert.equal(refundRate({ startAtUtc: at(48), now, cancelledBy: 'PATIENT' }), 1);
  assert.equal(refundRate({ startAtUtc: at(24.01), now, cancelledBy: 'PATIENT' }), 1);
  assert.equal(refundRate({ startAtUtc: at(24), now, cancelledBy: 'PATIENT' }), 0.5, 'exactly 24 h is not "more than 24 h"');
  assert.equal(refundRate({ startAtUtc: at(10), now, cancelledBy: 'PATIENT' }), 0.5);
  assert.equal(refundRate({ startAtUtc: at(2), now, cancelledBy: 'PATIENT' }), 0.5, 'exactly 2 h is not "less than 2 h"');
  assert.equal(refundRate({ startAtUtc: at(1.99), now, cancelledBy: 'PATIENT' }), 0);
  assert.equal(refundRate({ startAtUtc: at(0.1), now, cancelledBy: 'PATIENT' }), 0);
});

test('doctor cancellation is always a full refund', () => {
  for (const h of [48, 10, 1, 0.1]) assert.equal(refundRate({ startAtUtc: at(h), now, cancelledBy: 'DOCTOR' }), 1);
});

test('refund amounts are exact to the cent', () => {
  assert.equal(refundAmount('25.00', 1), '25.00');
  assert.equal(refundAmount('25.00', 0.5), '12.50');
  assert.equal(refundAmount('17.75', 0.5), '8.88');
  assert.equal(refundAmount('25.00', 0), '0.00');
});

test('one free reschedule, only more than 24 h before, only for confirmed appointments', () => {
  const base = { status: 'CONFIRMED', rescheduleCount: 0, startAtUtc: at(48) };
  assert.equal(rescheduleBlocker(base, now), null);
  assert.equal(rescheduleBlocker({ ...base, startAtUtc: at(24) }, now), 'TOO_LATE');
  assert.equal(rescheduleBlocker({ ...base, rescheduleCount: 1 }, now), 'ALREADY_RESCHEDULED');
  assert.equal(rescheduleBlocker({ ...base, status: 'PENDING_PAYMENT' }, now), 'NOT_CONFIRMED');
  assert.equal(rescheduleBlocker({ ...base, status: 'CANCELLED' }, now), 'NOT_CONFIRMED');
});

test('cancellation preview: unpaid holds cancel with nothing to refund; finished appointments cannot be cancelled', () => {
  const confirmed = { status: 'CONFIRMED', feeAmount: '20.00', startAtUtc: at(10) };
  assert.deepEqual(cancellationPreview(confirmed, { paid: true, now }), { allowed: true, rate: 0.5, amount: '10.00' });
  assert.deepEqual(cancellationPreview({ ...confirmed, status: 'PENDING_PAYMENT' }, { paid: false, now }), { allowed: true, rate: 0, amount: '0.00' });
  assert.deepEqual(cancellationPreview({ ...confirmed, status: 'COMPLETED' }, { paid: true, now }), { allowed: false, rate: 0, amount: '0.00' });
  assert.deepEqual(cancellationPreview(confirmed, { paid: true, now, cancelledBy: 'DOCTOR' }), { allowed: true, rate: 1, amount: '20.00' });
});
