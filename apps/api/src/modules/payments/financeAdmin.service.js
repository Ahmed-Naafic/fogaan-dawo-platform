import { getPaymentProvider } from '../../adapters/payment/index.js';
import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';
import { completeRefund, createRefundRequest, failRefund } from '../refunds/refund.service.js';
import * as refundRepository from '../refunds/refund.repository.js';
import * as paymentRepository from './payment.repository.js';
import { presentPayment } from './paymentSimulation.service.js';

/**
 * Admin financial management over SIMULATED transactions. Every figure is a demo figure; no money
 * moves. Refund processing asks the simulated provider adapter, then reuses the existing
 * completeRefund / failRefund rules (ledger, doctor earning, audit, admin notifications).
 */

const money = (d) => (d == null ? '0.00' : Number(d).toFixed(2));

/** Refund state of a payment for lists: NONE | REQUESTED | PARTIAL | FULL (successful refunds vs amount). */
export function refundState(payment) {
  const refunds = payment.refunds ?? [];
  const paidBack = refunds.filter((r) => r.status === 'SUCCEEDED').reduce((a, r) => a + Math.round(Number(r.amount) * 100), 0);
  if (paidBack > 0) return paidBack >= Math.round(Number(payment.amount) * 100) ? 'FULL' : 'PARTIAL';
  return refunds.some((r) => ['REQUESTED', 'PROCESSING'].includes(r.status)) ? 'REQUESTED' : 'NONE';
}

/** Superseded by finance.service overview (date ranges). Kept for reference. */
export async function legacyOverview(client = prisma) {
  const [paid, pending, failed, cancelled, refunded, openRefunds, failedRefunds, failedAttempts, commission, byProvider] = await Promise.all([
    paymentRepository.sumPayments(client, { status: 'SUCCEEDED' }),
    paymentRepository.countPayments(client, { status: 'PENDING' }),
    paymentRepository.countPayments(client, { status: 'FAILED' }),
    paymentRepository.countPayments(client, { status: 'CANCELLED' }),
    refundRepository.sumRefunds(client, { status: 'SUCCEEDED' }),
    refundRepository.sumRefunds(client, { status: { in: ['REQUESTED', 'PROCESSING'] } }),
    refundRepository.sumRefunds(client, { status: 'FAILED' }),
    paymentRepository.countAttempts(client, { status: 'FAILED' }),
    client.financialTransaction.aggregate({ where: { type: 'PLATFORM_COMMISSION', status: 'POSTED' }, _sum: { amount: true } }),
    client.payment.groupBy({ by: ['provider'], where: { status: 'SUCCEEDED' }, _sum: { amount: true }, _count: { _all: true } }),
  ]);
  const setting = await client.platformSetting.findUnique({ where: { key: 'commission_rate' } });
  const commissionRate = setting?.value?.rate == null ? null : Number(setting.value.rate).toFixed(4);
  const revenue = Number(paid._sum.amount ?? 0);
  const refunds = Number(refunded._sum.amount ?? 0);
  return {
    simulated: true,
    currency: 'USD',
    revenue: { amount: money(revenue), count: paid._count._all },
    refunds: { amount: money(refunds), count: refunded._count._all },
    net: money(revenue - refunds),
    commission: { amount: money(commission._sum.amount), rate: commissionRate, placeholder: true },
    pendingPayments: pending,
    failedPayments: failed,
    expiredOrCancelledPayments: cancelled,
    failedAttempts,
    openRefunds: { amount: money(openRefunds._sum.amount), count: openRefunds._count._all },
    failedRefunds: { amount: money(failedRefunds._sum.amount), count: failedRefunds._count._all },
    byProvider: byProvider.map((p) => ({ provider: p.provider, amount: money(p._sum.amount), count: p._count._all })),
  };
}

export async function listPayments({ status, provider, q, page, pageSize, range = null }, client = prisma) {
  const filters = { status, provider, q, from: range?.from ?? null, to: range?.to ?? null };
  const [rows, total] = await Promise.all([
    paymentRepository.listPaymentsForAdmin(client, filters, { skip: (page - 1) * pageSize, take: pageSize }),
    paymentRepository.countPaymentsForAdmin(client, filters),
  ]);
  return { items: rows.map((p) => ({ ...presentPayment(p, { forAdmin: true }), refundState: refundState(p) })), total, page, pageSize };
}

/** Audit trail of a payment: every attempt, status change and refund action, oldest first. */
async function auditTrail(client, payment) {
  const attemptIds = payment.attempts.map((a) => a.id);
  const refundIds = payment.refunds.map((r) => r.id);
  const logs = await client.auditLog.findMany({
    where: { OR: [{ entityType: 'PaymentAttempt', entityId: { in: attemptIds } }, { entityType: 'Refund', entityId: { in: refundIds } }] },
    orderBy: { createdAt: 'asc' },
    select: { action: true, entityType: true, entityId: true, newValues: true, createdAt: true, actor: { select: { fullName: true } } },
  });
  return logs.map((l) => ({ action: l.action, entity: l.entityType, entityId: l.entityId, details: l.newValues, by: l.actor?.fullName ?? 'System', at: l.createdAt.toISOString() }));
}

export async function getPayment(paymentId, client = prisma) {
  const payment = await paymentRepository.findPaymentDetail(client, paymentId);
  if (!payment) throw ApiError.notFound('Payment not found');
  const ledger = await client.financialTransaction.findMany({
    where: { OR: [{ paymentId }, { refund: { paymentId } }] },
    orderBy: { createdAt: 'asc' },
    select: { type: true, status: true, amount: true, currency: true, reference: true, createdAt: true, metadata: true },
  });
  const earning = payment.appointmentId ? await client.doctorEarning.findUnique({ where: { appointmentId: payment.appointmentId } }) : null;
  const rate = payment.appointmentId ? (await client.appointment.findUnique({ where: { id: payment.appointmentId }, select: { commissionRateSnapshot: true } }))?.commissionRateSnapshot : null;
  return {
    ...presentPayment(payment, { forAdmin: true }),
    refundState: refundState(payment),
    // The split saved when the payment succeeded (never recomputed from the current setting).
    allocation: earning ? { gross: earning.grossAmount.toFixed(2), commissionRate: rate == null ? null : Number(rate).toFixed(4), commission: earning.commissionAmount.toFixed(2), doctorEarning: earning.netAmount.toFixed(2), currency: earning.currency, status: earning.status } : null,
    ledger: ledger.map((e) => ({ type: e.type, kind: e.metadata?.kind ?? null, status: e.status, amount: e.amount.toFixed(2), currency: e.currency, reference: e.reference, createdAt: e.createdAt.toISOString() })),
    audit: await auditTrail(client, payment),
  };
}

export async function listRefunds({ status, q, page, pageSize, range = null }, client = prisma) {
  const filters = { status, q, from: range?.from ?? null, to: range?.to ?? null };
  const [rows, total] = await Promise.all([refundRepository.listRefundsForAdmin(client, filters, { skip: (page - 1) * pageSize, take: pageSize }), refundRepository.countRefundsForAdmin(client, filters)]);
  return {
    items: rows.map((r) => ({
      id: r.id,
      status: r.status,
      amount: r.amount.toFixed(2),
      currency: r.currency,
      reason: r.reason,
      reference: r.providerReference,
      createdAt: r.createdAt.toISOString(),
      processedAt: r.processedAt?.toISOString() ?? null,
      review: r.reviewedAt ? { by: r.reviewer?.fullName ?? null, at: r.reviewedAt.toISOString(), note: r.reviewNote } : null,
      paymentId: r.paymentId,
      provider: r.payment.provider,
      paymentAmount: r.payment.amount.toFixed(2),
      patient: { name: r.payment.patient.user.fullName },
      appointment: { id: r.appointment.id, startAtUtc: r.appointment.startAtUtc.toISOString(), doctor: { name: r.appointment.doctor.user.fullName } },
      simulated: true,
    })),
    total,
    page,
    pageSize,
  };
}

/**
 * Processes a REQUESTED refund through the simulated provider. REQUESTED → PROCESSING is claimed under a
 * row lock first, so two administrators (or two clicks) can never process the same refund twice.
 */
export async function processRefund({ refundId, adminUserId }, client = prisma) {
  const claimed = await withTransaction(async (tx) => {
    if (!(await lockRow(tx, 'refunds', refundId))) throw ApiError.notFound('Refund not found');
    const refund = await refundRepository.findRefundById(tx, refundId);
    if (refund.status !== 'REQUESTED') throw ApiError.conflict(`Refund is already ${refund.status}`, { status: refund.status }, 'REFUND_NOT_REQUESTED');
    await refundRepository.updateRefund(tx, refundId, { status: 'PROCESSING', reviewedBy: adminUserId, reviewedAt: new Date() });
    await auditRepository.createAuditLog(tx, { actorUserId: adminUserId, action: 'REFUND', entityType: 'Refund', entityId: refundId, oldValues: { status: 'REQUESTED' }, newValues: { status: 'PROCESSING', decision: 'APPROVED', amount: refund.amount.toString(), simulated: true } });
    const payment = await paymentRepository.findPaymentById(tx, refund.paymentId);
    const success = (await paymentRepository.findAttemptsForPayment(tx, payment.id)).find((a) => a.status === 'SUCCEEDED');
    return { refund, payment, success };
  }, { client });

  const provider = getPaymentProvider(claimed.payment.provider);
  const result = await provider.refund({
    amount: claimed.refund.amount.toFixed(2),
    currency: claimed.refund.currency,
    msisdn: `…${claimed.success?.responseData?.walletLast4 ?? ''}`,
    providerReference: claimed.success?.providerReference ?? null,
  });
  if (result.outcome === 'SUCCESS') await completeRefund({ refundId, providerReference: result.providerReference, actorUserId: adminUserId });
  else await failRefund({ refundId, error: result.message, actorUserId: adminUserId });
  return { outcome: result.outcome, message: result.message, refund: (await listRefunds({ q: refundId, page: 1, pageSize: 1 }, client)).items[0] ?? null };
}

/** A failed refund can be requested again for the same amount (the failed amount was released). */
export async function retryRefund({ refundId, adminUserId }, client = prisma) {
  const created = await withTransaction(async (tx) => {
    if (!(await lockRow(tx, 'refunds', refundId))) throw ApiError.notFound('Refund not found');
    const refund = await refundRepository.findRefundById(tx, refundId);
    if (refund.status !== 'FAILED') throw ApiError.conflict('Only a failed refund can be retried', { status: refund.status }, 'REFUND_NOT_FAILED');
    const fresh = await createRefundRequest(tx, { appointmentId: refund.appointmentId, reason: `Retry of failed refund ${refund.id}: ${refund.reason}`, amount: refund.amount });
    await auditRepository.createAuditLog(tx, { actorUserId: adminUserId, action: 'REFUND', entityType: 'Refund', entityId: fresh.id, newValues: { status: 'REQUESTED', retryOf: refund.id, amount: fresh.amount.toString(), simulated: true } });
    return fresh;
  }, { client });
  return { refund: (await listRefunds({ q: created.id, page: 1, pageSize: 1 }, client)).items[0] };
}
