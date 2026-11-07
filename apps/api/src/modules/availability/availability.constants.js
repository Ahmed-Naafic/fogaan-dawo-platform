/** Scheduling rules for doctor availability (mirrored by DB CHECK constraints where noted). */

/** Consultation lengths allowed by availability_rule_slot_duration (CHECK IN (20, 30)). */
export const SLOT_DURATIONS = Object.freeze([20, 30]);

/** How far ahead slots are published (days, in the doctor's zone, including today). */
export const SLOT_HORIZON_DAYS = 28;

/** Working periods per day (several periods = breaks between them). */
export const MAX_PERIODS_PER_DAY = 4;

/** Longest single block (whole days) and how far ahead a block may start. */
export const MAX_BLOCK_DAYS = 90;
export const MAX_BLOCK_START_AHEAD_DAYS = 365;

/** Public slot queries: max days per request. */
export const MAX_SLOT_QUERY_DAYS = 31;

export const AvailabilityErrorCode = Object.freeze({
  DOCTOR_NOT_BOOKABLE: 'DOCTOR_NOT_BOOKABLE',
  BLOCK_OVERLAP: 'BLOCK_OVERLAP',
  BLOCK_IN_PAST: 'BLOCK_IN_PAST',
  RULE_NOT_FOUND: 'RULE_NOT_FOUND',
  BLOCK_NOT_FOUND: 'BLOCK_NOT_FOUND',
});
