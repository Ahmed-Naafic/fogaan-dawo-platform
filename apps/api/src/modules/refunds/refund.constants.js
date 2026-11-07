/** Refund statuses that reserve part of a payment's refundable balance. FAILED releases it. */
export const COMMITTED_REFUND_STATUSES = Object.freeze(['REQUESTED', 'PROCESSING', 'SUCCEEDED']);
