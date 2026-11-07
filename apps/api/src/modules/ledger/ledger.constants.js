/**
 * Ledger conventions.
 * - Every amount is stored as a positive Decimal; the entry `type` gives its meaning.
 * - For one successful payment: PAYMENT = PLATFORM_COMMISSION + DOCTOR_EARNING.
 * - Successful REFUND entries for a payment never sum to more than its PAYMENT entry.
 * - Each successful REFUND is followed by two ADJUSTMENT entries that reverse the original split in
 *   proportion to the SAVED snapshot (commission reversal + doctor-earning reversal = refund amount).
 * - `reference` is the idempotency key: one deterministic reference per business event.
 * - The database trigger financial_transactions_append_only forbids deleting any row and
 *   changing a POSTED row; corrections are new compensating entries.
 */
export const LedgerReference = Object.freeze({
  payment: (paymentId) => `payment:${paymentId}`,
  commission: (paymentId) => `commission:${paymentId}`,
  doctorEarning: (paymentId) => `doctor-earning:${paymentId}`,
  refund: (refundId) => `refund:${refundId}`,
  /** A refund's reversal of the original split (ADJUSTMENT entries, from the saved commission snapshot). */
  refundCommissionReversal: (refundId) => `refund-commission-reversal:${refundId}`,
  refundEarningReversal: (refundId) => `refund-earning-reversal:${refundId}`,
});

/** ADJUSTMENT entry kinds (metadata.kind). Amounts stay positive; the kind gives the direction. */
export const AdjustmentKind = Object.freeze({
  commissionReversal: 'PLATFORM_COMMISSION_REVERSAL',
  earningReversal: 'DOCTOR_EARNING_REVERSAL',
});
