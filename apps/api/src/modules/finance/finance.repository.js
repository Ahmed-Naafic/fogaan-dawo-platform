import { inRange } from './finance.dates.js';

/**
 * Read-only queries for admin finance. Rows are fetched with only the fields reports need and are
 * aggregated in exact decimals by finance.service.js.
 */

const NAME = { select: { user: { select: { fullName: true } } } };

/** Successful payments whose money arrived in the range (by paid_at). */
export const succeededPayments = (client, range) =>
  client.payment.findMany({
    where: { status: 'SUCCEEDED', ...(range.from ? { paidAt: inRange(range) } : {}) },
    select: { id: true, amount: true, currency: true, provider: true, paidAt: true, appointmentId: true },
    orderBy: { paidAt: 'asc' },
  });

/** Payment counts per status for payments started in the range (by created_at). */
export const paymentStatusCounts = (client, range) =>
  client.payment.groupBy({ by: ['status'], where: range.from ? { createdAt: inRange(range) } : {}, _count: { _all: true }, _sum: { amount: true } });

export const failedAttemptCount = (client, range) => client.paymentAttempt.count({ where: { status: 'FAILED', ...(range.from ? { createdAt: inRange(range) } : {}) } });

/** Refunds paid out in the range (by processed_at). */
export const succeededRefunds = (client, range) =>
  client.refund.findMany({
    where: { status: 'SUCCEEDED', ...(range.from ? { processedAt: inRange(range) } : {}) },
    select: { id: true, paymentId: true, appointmentId: true, amount: true, processedAt: true, createdAt: true, payment: { select: { provider: true } } },
    orderBy: { processedAt: 'asc' },
  });

/** Every successful refund of the given payments, oldest first (needed for cumulative allocation). */
export const allSucceededRefundsForPayments = (client, paymentIds) =>
  paymentIds.length
    ? client.refund.findMany({ where: { status: 'SUCCEEDED', paymentId: { in: paymentIds } }, select: { id: true, paymentId: true, appointmentId: true, amount: true, processedAt: true, createdAt: true }, orderBy: [{ processedAt: 'asc' }, { createdAt: 'asc' }] })
    : [];

/** Refund counts per status for refunds requested in the range (by created_at). */
export const refundStatusCounts = (client, range) =>
  client.refund.groupBy({ by: ['status'], where: range.from ? { createdAt: inRange(range) } : {}, _count: { _all: true }, _sum: { amount: true } });

/** Refunds waiting for an administrator, whatever their date (the review queue). */
export const openRefundTotals = (client) => client.refund.aggregate({ where: { status: { in: ['REQUESTED', 'PROCESSING'] } }, _count: { _all: true }, _sum: { amount: true } });

/** Earning snapshots by paying appointment. */
export const earningsForAppointments = (client, appointmentIds) =>
  appointmentIds.length ? client.doctorEarning.findMany({ where: { appointmentId: { in: appointmentIds } } }) : [];

/** Earning snapshots created (= payment succeeded) in the range, with doctor, appointment status and the snapshot rate. */
export const earningsInRange = (client, range, { q } = {}) =>
  client.doctorEarning.findMany({
    where: { ...(range.from ? { createdAt: inRange(range) } : {}), ...(q ? { doctor: { user: { fullName: { contains: q, mode: 'insensitive' } } } } : {}) },
    select: {
      id: true,
      appointmentId: true,
      doctorId: true,
      grossAmount: true,
      commissionAmount: true,
      netAmount: true,
      currency: true,
      status: true,
      createdAt: true,
      doctor: { select: { id: true, ...NAME.select } },
      appointment: { select: { status: true, commissionRateSnapshot: true, payment: { select: { id: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });

export const findSetting = (client, key) => client.platformSetting.findUnique({ where: { key }, include: { updatedByUser: { select: { fullName: true } } } });

export const settingHistory = (client, key, take = 20) =>
  client.auditLog.findMany({ where: { entityType: 'PlatformSetting', entityId: key }, orderBy: { createdAt: 'desc' }, take, select: { oldValues: true, newValues: true, createdAt: true, actor: { select: { fullName: true } } } });

export const refundAudit = (client, refundId) =>
  client.auditLog.findMany({ where: { entityType: 'Refund', entityId: refundId }, orderBy: { createdAt: 'asc' }, select: { action: true, oldValues: true, newValues: true, createdAt: true, actor: { select: { fullName: true } } } });
