/** Pure helpers for the admin Doctors page (unit-tested). */

export const DOCTOR_TABS = Object.freeze(['all', 'verified', 'pending', 'rejected', 'suspended']);
export const MIN_REASON = 10;
export const MAX_REASON = 500;

/** Client check mirroring the API: a reason of 10–500 characters is required. */
export function validateSuspensionReason(reason) {
  const r = String(reason ?? '').trim();
  if (r.length < MIN_REASON) return 'adminDoctors.errors.reasonShort';
  if (r.length > MAX_REASON) return 'adminDoctors.errors.reasonLong';
  return null;
}

/** Only active doctors can be suspended (the API refuses a second suspension). */
export const canSuspend = (doctor, adminUserId) => doctor.accountStatus === 'ACTIVE' && doctor.userId !== adminUserId;

/** Status shown on the card: suspension wins over verification. */
export const displayStatus = (doctor) => (doctor.accountStatus !== 'ACTIVE' ? 'SUSPENDED' : doctor.verificationStatus);

const CODES = new Set(['DOCTOR_ALREADY_SUSPENDED', 'SELF_ACTION_FORBIDDEN', 'VALIDATION_ERROR', 'NOT_FOUND', 'RATE_LIMITED', 'NETWORK_ERROR']);
export const adminDoctorErrorKey = (error) => `adminDoctors.apiErrors.${CODES.has(error?.code) ? error.code : 'GENERIC'}`;
