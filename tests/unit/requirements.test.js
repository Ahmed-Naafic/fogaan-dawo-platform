// Business rules added to close the requirements gaps — pure functions, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_ADMIT_REFUND_MINUTES, noShowRefundBlocker } from '../../apps/api/src/modules/appointments/appointment.policy.js';
import { followUpFee, isFreeAppointment } from '../../apps/api/src/modules/appointments/followUp.service.js';
import { isFlagged, monthBounds, DOCTOR_CANCEL_FLAG_THRESHOLD } from '../../apps/api/src/modules/doctors/doctorCancellations.js';
import { ratingAction } from '../../apps/api/src/modules/reviews/review.service.js';
import { hasNoteText } from '../../apps/api/src/modules/consultations/consultation.service.js';
import { isSmsKind } from '../../apps/api/src/modules/notifications/sms.service.js';
import { getSmsProvider } from '../../apps/api/src/adapters/sms/index.js';
import { renderDemoReceipt } from '../../apps/api/src/modules/payments/paymentReceipt.js';

const at = (iso) => new Date(iso);
const appt = (status = 'CONFIRMED') => ({ status, startAtUtc: at('2026-11-10T10:00:00Z'), endAtUtc: at('2026-11-10T10:30:00Z') });

test('no-show refund (req. 6): only after 15 minutes past the start, paid, never admitted', () => {
  assert.equal(NO_ADMIT_REFUND_MINUTES, 15);
  const ok = { paid: true, refunded: false };
  assert.equal(noShowRefundBlocker(appt(), { ...ok, now: at('2026-11-10T10:14:59Z') }), 'TOO_EARLY');
  assert.equal(noShowRefundBlocker(appt(), { ...ok, now: at('2026-11-10T10:15:00Z') }), null, 'exactly 15 minutes');
  assert.equal(noShowRefundBlocker(appt('WAITING'), { ...ok, now: at('2026-11-10T10:20:00Z') }), null, 'patient in the waiting room');
  assert.equal(noShowRefundBlocker(appt('WAITING'), { ...ok, consultation: { status: 'IN_PROGRESS' }, now: at('2026-11-10T10:20:00Z') }), 'ADMITTED');
  assert.equal(noShowRefundBlocker(appt(), { paid: false, now: at('2026-11-10T10:20:00Z') }), 'NOT_PAID');
  assert.equal(noShowRefundBlocker(appt(), { paid: true, refunded: true, now: at('2026-11-10T10:20:00Z') }), 'NOT_PAID', 'already refunded');
  for (const s of ['COMPLETED', 'CANCELLED', 'PENDING_PAYMENT']) assert.equal(noShowRefundBlocker(appt(s), { ...ok, now: at('2026-11-10T10:20:00Z') }), 'NOT_ELIGIBLE', s);
});

test('follow-up fee (req. 12): normal, 50 % discount, free', () => {
  assert.equal(followUpFee('NORMAL', '25.00').toFixed(2), '25.00');
  assert.equal(followUpFee('DISCOUNTED', '25.00').toFixed(2), '12.50');
  assert.equal(followUpFee('DISCOUNTED', '15.00').toFixed(2), '7.50');
  assert.equal(followUpFee('FREE', '25.00').toFixed(2), '0.00');
  assert.equal(isFreeAppointment({ bookingType: 'FOLLOW_UP', feeAmount: '0.00' }), true);
  assert.equal(isFreeAppointment({ bookingType: 'STANDARD', feeAmount: '0.00' }), false);
  assert.equal(isFreeAppointment({ bookingType: 'FOLLOW_UP', feeAmount: '12.50' }), false);
});

test('doctor cancellation flag (req. 11): more than 3 in a calendar month', () => {
  assert.equal(DOCTOR_CANCEL_FLAG_THRESHOLD, 3);
  assert.equal(isFlagged(3), false);
  assert.equal(isFlagged(4), true);
  const { from, to } = monthBounds(at('2026-11-18T09:00:00Z'));
  assert.equal(from.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(to.toISOString(), '2026-12-01T00:00:00.000Z');
});

test('ratings (req. 13): only completed consultations, once each', () => {
  assert.deepEqual(ratingAction({ status: 'COMPLETED' }, null), { allowed: true, blocker: null });
  assert.deepEqual(ratingAction({ status: 'COMPLETED' }, { id: 'r1' }), { allowed: false, blocker: 'ALREADY_RATED' });
  for (const s of ['CONFIRMED', 'CANCELLED', 'IN_PROGRESS']) assert.equal(ratingAction({ status: s }, null).blocker, 'NOT_COMPLETED', s);
});

test('consultation notes (req. 9): completion needs at least one written section', () => {
  assert.equal(hasNoteText(null), false);
  assert.equal(hasNoteText({ complaint: '   ', advice: '' }), false);
  assert.equal(hasNoteText({ shareAdvice: true }), false, 'share flags alone are not notes');
  assert.equal(hasNoteText({ diagnosis: 'Viral URTI' }), true);
});

test('SMS (baseline): simulated adapter delivers nothing externally; important kinds only', async () => {
  const sms = getSmsProvider();
  assert.equal(sms.code, 'SIMULATED');
  const r = await sms.send({ to: '+252615551234', message: 'Test' });
  assert.equal(r.status, 'SENT');
  assert.match(r.providerReference, /^SMS-DEMO-/);
  assert.equal((await sms.send({ to: '+252615551234', message: '' })).status, 'FAILED');
  assert.equal(isSmsKind('payment.confirmed'), true);
  assert.equal(isSmsKind('appointment.reminder.BEFORE_1H'), true);
  assert.equal(isSmsKind('followup.proposed.free'), true);
  assert.equal(isSmsKind('document.uploaded'), false);
});

test('receipt PDF (baseline): English and Somali', () => {
  const payment = {
    id: 'pay-1',
    reference: 'EVC-DEMO-1',
    paidAt: '2026-11-10T08:00:00Z',
    provider: 'EVC_PLUS',
    currency: 'USD',
    amount: '20.00',
    status: 'SUCCEEDED',
    attempts: [{ status: 'SUCCEEDED', wallet: '+252 61 ••• 1234' }],
    refunds: [],
    appointment: { startAtUtc: '2026-11-11T10:00:00Z', patient: { name: 'Amina Cabdi' }, doctor: { name: 'Dr. Maxamed Faarax', specialty: { nameEn: 'Cardiology', nameSo: 'Wadnaha' } } },
  };
  const en = renderDemoReceipt(payment, { lang: 'en' }).toString('latin1');
  const so = renderDemoReceipt(payment, { lang: 'so' }).toString('latin1');
  assert.ok(en.startsWith('%PDF'));
  assert.ok(so.startsWith('%PDF'));
  assert.notEqual(en, so, 'the two languages produce different documents');
});
