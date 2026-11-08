/**
 * Approved booking business rules as pure functions (unit-tested). Defaults below; an administrator may
 * change the hour thresholds and the reschedule allowance in Admin › Settings (callers pass `policy`):
 *  - Patient cancellation: > 24 h before start → 100 % refund; 2–24 h → 50 %; < 2 h → no refund.
 *  - Doctor cancellation → full refund.
 *  - One free reschedule, only more than 24 h before the appointment; it creates a linked new appointment.
 */

export const FULL_REFUND_MIN_HOURS = 24;
export const PARTIAL_REFUND_MIN_HOURS = 2;
export const PARTIAL_REFUND_RATE = 0.5;
export const FREE_RESCHEDULE_MIN_HOURS = 24;
export const MAX_FREE_RESCHEDULES = 1;

const HOUR = 3_600_000;

/** The approved defaults; Admin › Settings may override them (see settings/bookingPolicy.js). */
const DEFAULTS = Object.freeze({ fullRefundMinHours: FULL_REFUND_MIN_HOURS, partialRefundMinHours: PARTIAL_REFUND_MIN_HOURS, freeRescheduleMinHours: FREE_RESCHEDULE_MIN_HOURS, maxFreeReschedules: MAX_FREE_RESCHEDULES });

export const hoursUntil = (startAtUtc, now) => (new Date(startAtUtc).getTime() - now.getTime()) / HOUR;

/**
 * Refund share for a cancellation (0, 0.5 or 1). Boundaries: exactly 24 h before is the 50 % band
 * ("more than 24 hours" earns 100 %); exactly 2 h before is still 50 % ("less than 2 hours" earns nothing).
 */
export function refundRate({ startAtUtc, now = new Date(), cancelledBy, policy = DEFAULTS }) {
  if (cancelledBy === 'DOCTOR' || cancelledBy === 'SYSTEM') return 1;
  const hours = hoursUntil(startAtUtc, now);
  if (hours > policy.fullRefundMinHours) return 1;
  if (hours >= policy.partialRefundMinHours) return PARTIAL_REFUND_RATE;
  return 0;
}

/** Refund amount in cents-safe 2-decimal string for a paid fee. */
export function refundAmount(feeAmount, rate) {
  const cents = Math.round(Number(feeAmount) * 100);
  return (Math.round(cents * rate) / 100).toFixed(2);
}

/** Statuses a patient or doctor may cancel. */
/** Requirement 6: if the doctor has not admitted the patient this many minutes after the start, the patient may ask for a full refund. */
export const NO_ADMIT_REFUND_MINUTES = 15;

/**
 * Why a "doctor did not admit me" full refund cannot be requested now, or null when it can.
 * Paid, still CONFIRMED or WAITING (never admitted: the consultation is not in progress or completed),
 * and at least 15 minutes past the start.
 */
export function noShowRefundBlocker(appointment, { paid, consultation = null, refunded = false, now = new Date() }) {
  if (!['CONFIRMED', 'WAITING'].includes(appointment.status)) return 'NOT_ELIGIBLE';
  if (!paid || refunded) return 'NOT_PAID';
  if (consultation && ['IN_PROGRESS', 'COMPLETED'].includes(consultation.status)) return 'ADMITTED';
  if (now.getTime() < new Date(appointment.startAtUtc).getTime() + NO_ADMIT_REFUND_MINUTES * 60_000) return 'TOO_EARLY';
  return null;
}

export const CANCELLABLE_STATUSES = Object.freeze(['PENDING_PAYMENT', 'CONFIRMED']);

/** Why an appointment cannot be rescheduled for free right now, or null if it can. */
export function rescheduleBlocker(appointment, now = new Date(), policy = DEFAULTS) {
  if (appointment.status !== 'CONFIRMED') return 'NOT_CONFIRMED';
  if (appointment.rescheduleCount >= policy.maxFreeReschedules) return 'ALREADY_RESCHEDULED';
  if (hoursUntil(appointment.startAtUtc, now) <= policy.freeRescheduleMinHours) return 'TOO_LATE';
  return null;
}

/** What a patient cancellation would do now: { allowed, rate, amount } (amount only for paid appointments). */
export function cancellationPreview(appointment, { paid, now = new Date(), cancelledBy = 'PATIENT', policy = DEFAULTS }) {
  if (!CANCELLABLE_STATUSES.includes(appointment.status)) return { allowed: false, rate: 0, amount: '0.00' };
  if (!paid) return { allowed: true, rate: 0, amount: '0.00' };
  const rate = refundRate({ startAtUtc: appointment.startAtUtc, now, cancelledBy, policy });
  return { allowed: true, rate, amount: refundAmount(appointment.feeAmount, rate) };
}
