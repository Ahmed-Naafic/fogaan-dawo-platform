import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { roundMoney, sumMoney, toDecimal } from '../../utils/money.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';
import { allocateRefunds } from '../finance/finance.calc.js';
import { AdjustmentKind, LedgerReference } from '../ledger/ledger.constants.js';
import * as ledgerRepository from '../ledger/ledger.repository.js';
import * as notificationEvents from '../notifications/notification.events.js';
import * as appointmentRepository from '../appointments/appointment.repository.js';
import * as paymentRepository from '../payments/payment.repository.js';
import { COMMITTED_REFUND_STATUSES } from './refund.constants.js';
import * as refundRepository from './refund.repository.js';

async function refundTotals(tx, paymentId) {
  const refunds = await refundRepository.findRefundsForPayment(tx, paymentId);
  const committed = sumMoney(refunds.filter((r) => COMMITTED_REFUND_STATUSES.includes(r.status)).map((r) => r.amount));
  const succeeded = sumMoney(refunds.filter((r) => r.status === 'SUCCEEDED').map((r) => r.amount));
  return { committed, succeeded };
}

async function lockOpenRefund(tx, refundId) {
  if (!(await lockRow(tx, 'refunds', refundId))) throw ApiError.notFound('Refund not found');
  const refund = await refundRepository.findRefundById(tx, refundId);
  if (!['REQUESTED', 'PROCESSING'].includes(refund.status)) throw ApiError.conflict(`Refund is already ${refund.status}`);
  return refund;
}

/**
 * The payment that paid for an appointment. A rescheduled appointment is paid by the appointment it
 * replaced (the payment stays linked to the original; financial records are never moved), so the
 * chain of originalAppointmentId links is followed. Returns { payment, appointmentId } or null.
 */
export async function findPaymentForAppointment(tx, appointmentId) {
  let id = appointmentId;
  for (let depth = 0; id && depth < 10; depth += 1) {
    const payment = await paymentRepository.findPaymentByAppointmentId(tx, id);
    if (payment) return { payment, appointmentId: id };
    id = (await appointmentRepository.findAppointmentById(tx, id))?.originalAppointmentId ?? null;
  }
  return null;
}

/**
 * Creates a REQUESTED refund inside an existing transaction. Locks the payment row so concurrent
 * requests cannot together exceed the payment amount. `amount` defaults to the full remaining balance.
 */
export async function createRefundRequest(tx, { appointmentId, reason, amount = null }) {
  const paid = await findPaymentForAppointment(tx, appointmentId);
  const payment = paid?.payment;
  if (!payment || payment.status !== 'SUCCEEDED') throw ApiError.conflict('Appointment has no successful payment to refund');
  await lockRow(tx, 'payments', payment.id);

  const { committed } = await refundTotals(tx, payment.id);
  const remaining = toDecimal(payment.amount).minus(committed);
  const value = amount == null ? remaining : roundMoney(amount);
  if (value.lessThanOrEqualTo(0)) throw ApiError.conflict('Nothing left to refund for this payment');
  if (value.greaterThan(remaining)) throw ApiError.conflict(`Refund ${value} exceeds refundable balance ${remaining}`);

  // Recorded against the paying appointment so the doctor-earning update stays consistent.
  return refundRepository.createRefund(tx, { paymentId: payment.id, appointmentId: paid.appointmentId, amount: value, currency: payment.currency, reason });
}

export function requestRefund(input) {
  return withTransaction((tx) => createRefundRequest(tx, input));
}

/** Marks a refund as paid out: posts the REFUND ledger entry and updates the doctor's earning status. */
export async function completeRefund({ refundId, providerReference = null, actorUserId = null, now = new Date() }) {
  return withTransaction(async (tx) => {
    const refund = await lockOpenRefund(tx, refundId);
    await lockRow(tx, 'payments', refund.paymentId);
    const payment = await paymentRepository.findPaymentById(tx, refund.paymentId);

    const { succeeded } = await refundTotals(tx, payment.id);
    const refundedTotal = succeeded.plus(refund.amount);
    if (refundedTotal.greaterThan(payment.amount)) throw ApiError.conflict('Refunds would exceed the payment amount');

    const updated = await refundRepository.updateRefund(tx, refundId, { status: 'SUCCEEDED', providerReference, processedAt: now });
    const source = actorUserId ? 'ADMIN' : 'SYSTEM';
    const metadata = { appointmentId: refund.appointmentId, patientId: payment.patientId, actorUserId, source };
    await ledgerRepository.postEntry(tx, {
      type: 'REFUND',
      amount: refund.amount,
      currency: refund.currency,
      reference: LedgerReference.refund(refundId),
      paymentId: payment.id,
      refundId,
      metadata,
    });
    // Reverse the original split in proportion to the SAVED snapshot (never the current commission rate).
    const earning = await tx.doctorEarning.findUnique({ where: { appointmentId: refund.appointmentId } });
    if (earning) {
      const earlier = (await refundRepository.findRefundsForPayment(tx, payment.id))
        .filter((r) => r.status === 'SUCCEEDED' && r.id !== refundId)
        .sort((a, b) => a.processedAt - b.processedAt || a.createdAt - b.createdAt);
      const shares = allocateRefunds({ gross: earning.grossAmount, commission: earning.commissionAmount }, [...earlier.map((r) => r.amount), refund.amount]);
      const mine = shares[shares.length - 1];
      const common = { currency: refund.currency, paymentId: payment.id, refundId, metadata: { ...metadata, doctorId: earning.doctorId, reverses: null } };
      await ledgerRepository.postEntry(tx, { ...common, type: 'ADJUSTMENT', amount: mine.commission, reference: LedgerReference.refundCommissionReversal(refundId), metadata: { ...common.metadata, kind: AdjustmentKind.commissionReversal, reverses: LedgerReference.commission(payment.id) } });
      await ledgerRepository.postEntry(tx, { ...common, type: 'ADJUSTMENT', amount: mine.doctor, reference: LedgerReference.refundEarningReversal(refundId), metadata: { ...common.metadata, kind: AdjustmentKind.earningReversal, reverses: LedgerReference.doctorEarning(payment.id) } });
    }
    await paymentRepository.setDoctorEarningStatus(tx, refund.appointmentId, refundedTotal.equals(payment.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED');
    await auditRepository.createAuditLog(tx, {
      actorUserId,
      action: 'REFUND',
      entityType: 'Refund',
      entityId: refundId,
      newValues: { status: 'SUCCEEDED', amount: refund.amount.toString() },
    });
    await notificationEvents.refundCompleted(tx, refund);
    return updated;
  });
}

/**
 * Marks a refund as failed and makes the failure visible to administrators:
 * an audit-log entry with the provider error and a notification to every ADMIN user.
 * The failed amount is released, so a new refund request can be created for it.
 */
export async function failRefund({ refundId, error, actorUserId = null, now = new Date() }) {
  return withTransaction(async (tx) => {
    const refund = await lockOpenRefund(tx, refundId);
    const updated = await refundRepository.updateRefund(tx, refundId, { status: 'FAILED', processedAt: now });
    await auditRepository.createAuditLog(tx, {
      actorUserId,
      action: 'REFUND',
      entityType: 'Refund',
      entityId: refundId,
      oldValues: { status: refund.status },
      newValues: { status: 'FAILED', error: String(error).slice(0, 1000) },
    });
    await notificationEvents.refundFailed(tx, refund);
    return updated;
  });
}

/** Admin queue: every failed refund with its recorded failure reason. */
export async function listFailedRefunds(client = prisma) {
  const refunds = await refundRepository.findRefundsByStatus(client, 'FAILED');
  const audits = await auditRepository.findAuditLogs(client, { entityType: 'Refund', entityIds: refunds.map((r) => r.id), action: 'REFUND' });
  return refunds.map((r) => ({
    ...r,
    failureReason: audits.find((a) => a.entityId === r.id && a.newValues?.status === 'FAILED')?.newValues.error ?? null,
  }));
}
