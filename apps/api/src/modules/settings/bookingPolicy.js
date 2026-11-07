import { ApiError } from '../../utils/ApiError.js';
import { FOLLOW_UP_DEADLINE_HOURS, PAYMENT_HOLD_MINUTES } from '../appointments/appointment.constants.js';
import { FREE_RESCHEDULE_MIN_HOURS, FULL_REFUND_MIN_HOURS, MAX_FREE_RESCHEDULES, PARTIAL_REFUND_MIN_HOURS } from '../appointments/appointment.policy.js';
import * as settingRepository from './setting.repository.js';

/**
 * Booking rules an administrator can change (Admin › Settings), stored as one PlatformSetting row
 * ("booking_policy"). Missing fields fall back to the approved defaults below, so behaviour is unchanged
 * until an administrator saves a different value. Every rule is applied at the moment it is used
 * (booking, cancelling, rescheduling); past appointments are never recalculated.
 */
export const BOOKING_POLICY_KEY = 'booking_policy';

export const DEFAULT_BOOKING_POLICY = Object.freeze({
  paymentHoldMinutes: PAYMENT_HOLD_MINUTES,
  followUpDeadlineHours: FOLLOW_UP_DEADLINE_HOURS,
  maxFreeReschedules: MAX_FREE_RESCHEDULES,
  freeRescheduleMinHours: FREE_RESCHEDULE_MIN_HOURS,
  fullRefundMinHours: FULL_REFUND_MIN_HOURS,
  partialRefundMinHours: PARTIAL_REFUND_MIN_HOURS,
});

/** Allowed range for each value (whole numbers). */
export const BOOKING_POLICY_LIMITS = Object.freeze({
  paymentHoldMinutes: { min: 5, max: 60 },
  followUpDeadlineHours: { min: 1, max: 168 },
  maxFreeReschedules: { min: 0, max: 5 },
  freeRescheduleMinHours: { min: 0, max: 168 },
  fullRefundMinHours: { min: 1, max: 168 },
  partialRefundMinHours: { min: 0, max: 72 },
});

export const BookingPolicyErrorCode = Object.freeze({ INVALID: 'BOOKING_POLICY_INVALID', UNCHANGED: 'BOOKING_POLICY_UNCHANGED' });

/** Stored value merged over the defaults; ignores anything stored that is not a valid whole number in range. */
export function mergePolicy(stored) {
  const out = { ...DEFAULT_BOOKING_POLICY };
  for (const [k, { min, max }] of Object.entries(BOOKING_POLICY_LIMITS)) {
    const v = stored?.[k];
    if (Number.isInteger(v) && v >= min && v <= max) out[k] = v;
  }
  return out;
}

/** Problems with a full candidate policy, as [{ path, message }] (empty when valid). */
export function policyProblems(p) {
  const problems = [];
  for (const [k, { min, max }] of Object.entries(BOOKING_POLICY_LIMITS)) {
    if (!Number.isInteger(p[k]) || p[k] < min || p[k] > max) problems.push({ path: k, message: `Must be a whole number from ${min} to ${max}` });
  }
  if (problems.length === 0 && p.partialRefundMinHours >= p.fullRefundMinHours) {
    problems.push({ path: 'partialRefundMinHours', message: 'The partial-refund cut-off must be earlier than the full-refund cut-off' });
  }
  return problems;
}

/** The booking policy in force now. */
export async function getBookingPolicy(client) {
  const row = await settingRepository.findSettingByKey(client, BOOKING_POLICY_KEY);
  return mergePolicy(row?.value);
}

export function assertValidPolicy(candidate) {
  const problems = policyProblems(candidate);
  if (problems.length) throw ApiError.badRequest('The booking rules are not valid', problems, BookingPolicyErrorCode.INVALID);
}
