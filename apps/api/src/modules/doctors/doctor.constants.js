/** A doctor is visible in search and may publish availability / be booked only when all hold. */
export const BOOKABLE_DOCTOR_WHERE = Object.freeze({
  verificationStatus: 'VERIFIED',
  accountStatus: 'ACTIVE',
  user: { status: 'ACTIVE' },
});

/** Appointment statuses cancelled (with full refund requests) when a doctor is suspended. */
export const SUSPENSION_CANCELLABLE_STATUSES = Object.freeze(['PENDING_PAYMENT', 'CONFIRMED', 'WAITING']);
