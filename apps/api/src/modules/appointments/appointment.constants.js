/** Normal bookings hold the slot for 10 minutes while the patient pays. */
export const PAYMENT_HOLD_MINUTES = 10;

/** Follow-up bookings have a separate 48-hour confirmation + payment deadline. */
export const FOLLOW_UP_DEADLINE_HOURS = 48;

/** Statuses that occupy a slot (mirrors the partial unique index appointments_one_active_per_slot). */
export const ACTIVE_APPOINTMENT_STATUSES = Object.freeze(['PENDING_PAYMENT', 'CONFIRMED', 'WAITING', 'IN_PROGRESS']);
