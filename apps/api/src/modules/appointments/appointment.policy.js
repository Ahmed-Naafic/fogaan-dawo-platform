/**
 * Approved booking business rules as pure functions (unit-tested). No new rules are introduced here:
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
export const hoursUntil = (startAtUtc, now) => (new Date(startAtUtc).getTime() - now.getTime()) / HOUR;

/**
 * Refund share for a cancellation (0, 0.5 or 1). Boundaries: exactly 24 h before is the 50 % band
 * ("more than 24 hours" earns 100 %); exactly 2 h before is still 50 % ("less than 2 hours" earns nothing).
 */
export function refundRate({ startAtUtc, now = new Date(), cancelledBy }) {
  if (cancelledBy === 'DOCTOR' || cancelledBy === 'SYSTEM') return 1;
  const hours = hoursUntil(startAtUtc, now);
  if (hours > FULL_REFUND_MIN_HOURS) return 1;
  if (hours >= PARTIAL_REFUND_MIN_HOURS) return PARTIAL_REFUND_RATE;
  return 0;
}

/** Refund amount in cents-safe 2-decimal string for a paid fee. */
export function refundAmount(feeAmount, rate) {
  const cents = Math.round(Number(feeAmount) * 100);
  return (Math.round(cents * rate) / 100).toFixed(2);
}

/** Statuses a patient or doctor may cancel. */
export const CANCELLABLE_STATUSES = Object.freeze(['PENDING_PAYMENT', 'CONFIRMED']);

/** Why an appointment cannot be rescheduled for free right now, or null if it can. */
export function rescheduleBlocker(appointment, now = new Date()) {
  if (appointment.status !== 'CONFIRMED') return 'NOT_CONFIRMED';
  if (appointment.rescheduleCount >= MAX_FREE_RESCHEDULES) return 'ALREADY_RESCHEDULED';
  if (hoursUntil(appointment.startAtUtc, now) <= FREE_RESCHEDULE_MIN_HOURS) return 'TOO_LATE';
  return null;
}

/** What a patient cancellation would do now: { allowed, rate, amount } (amount only for paid appointments). */
export function cancellationPreview(appointment, { paid, now = new Date(), cancelledBy = 'PATIENT' }) {
  if (!CANCELLABLE_STATUSES.includes(appointment.status)) return { allowed: false, rate: 0, amount: '0.00' };
  if (!paid) return { allowed: true, rate: 0, amount: '0.00' };
  const rate = refundRate({ startAtUtc: appointment.startAtUtc, now, cancelledBy });
  return { allowed: true, rate, amount: refundAmount(appointment.feeAmount, rate) };
}
