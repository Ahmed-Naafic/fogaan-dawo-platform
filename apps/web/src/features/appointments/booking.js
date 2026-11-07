/** Pure helpers for booking screens (unit-tested). */

/** Remaining milliseconds of a hold, corrected for the difference between server and device clocks. */
export function remainingMs(holdExpiresAt, { serverTime, receivedAt }, now = Date.now()) {
  if (!holdExpiresAt) return 0;
  const skew = serverTime ? Date.parse(serverTime) - receivedAt : 0;
  return Math.max(0, Date.parse(holdExpiresAt) - (now + skew));
}

export const formatCountdown = (ms) => {
  const total = Math.ceil(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** Badge tone per appointment status (existing palette). */
export const APPOINTMENT_TONE = Object.freeze({
  PENDING_PAYMENT: 'gold',
  CONFIRMED: 'green',
  WAITING: 'gold',
  IN_PROGRESS: 'teal',
  COMPLETED: 'blue',
  CANCELLED: 'red',
  EXPIRED: 'neutral',
  RESCHEDULED: 'purple',
  NO_SHOW: 'neutral',
});

/** "100%" / "50%" / "0%" for the refund preview. */
export const ratePercent = (rate) => `${Math.round(Number(rate) * 100)}%`;

const CODES = new Set(['SLOT_UNAVAILABLE', 'SELF_BOOKING_FORBIDDEN', 'PATIENT_PROFILE_REQUIRED', 'APPOINTMENT_NOT_CANCELLABLE', 'RESCHEDULE_NOT_ALLOWED', 'VALIDATION_ERROR', 'RATE_LIMITED', 'NETWORK_ERROR', 'NOT_FOUND']);
export const bookingErrorKey = (error) => {
  if (error?.code === 'RESCHEDULE_NOT_ALLOWED' && error.details?.blocker) return `bookingErrors.reschedule.${error.details.blocker}`;
  return `bookingErrors.${CODES.has(error?.code) ? error.code : 'GENERIC'}`;
};
