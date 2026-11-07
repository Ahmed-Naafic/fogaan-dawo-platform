import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { sumMoney, toDecimal } from '../../utils/money.js';
import * as paymentRepository from '../payments/payment.repository.js';
import * as ledgerRepository from './ledger.repository.js';

/**
 * Checks the ledger invariants for one payment and returns a report (does not throw on violations).
 * Used by tests and, later, by admin reconciliation.
 */
export async function verifyPaymentLedger(paymentId, client = prisma) {
  const payment = await paymentRepository.findPaymentById(client, paymentId);
  if (!payment) throw ApiError.notFound('Payment not found');
  const posted = (await ledgerRepository.findEntriesForPayment(client, paymentId)).filter((e) => e.status === 'POSTED');
  const total = (type) => sumMoney(posted.filter((e) => e.type === type).map((e) => e.amount));

  const paid = total('PAYMENT');
  const commission = total('PLATFORM_COMMISSION');
  const earning = total('DOCTOR_EARNING');
  const refunded = total('REFUND');
  const adjustments = posted.filter((e) => e.type === 'ADJUSTMENT');
  const reversed = sumMoney(adjustments.map((e) => e.amount));
  const amount = toDecimal(payment.amount);

  const problems = [];
  if (payment.status === 'SUCCEEDED' && !paid.equals(amount)) problems.push(`PAYMENT entries ${paid} != payment amount ${amount}`);
  if (!commission.plus(earning).equals(paid)) problems.push(`commission ${commission} + earning ${earning} != payment ${paid}`);
  if (refunded.greaterThan(paid)) problems.push(`refunds ${refunded} exceed payment ${paid}`);
  if (posted.some((e) => e.currency !== payment.currency)) problems.push('currency mismatch');
  // Refunds paid out after Phase 8 carry reversal entries: they never exceed what was refunded.
  if (reversed.greaterThan(refunded)) problems.push(`reversals ${reversed} exceed refunds ${refunded}`);

  return { ok: problems.length === 0, problems, paid, commission, earning, refunded, reversed };
}
