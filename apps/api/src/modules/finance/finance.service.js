import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { Decimal, sumMoney, toDecimal } from '../../utils/money.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';
import * as notificationEvents from '../notifications/notification.events.js';
import * as refundRepository from '../refunds/refund.repository.js';
import { SettingKey } from '../settings/setting.service.js';
import { allocateRefunds, commissionFractionFromPercent, earningsTotals, money, percentFromFraction } from './finance.calc.js';
import { dayKey, describeRange, monthKey, resolveRange } from './finance.dates.js';
import * as repo from './finance.repository.js';

/**
 * Admin finance over SIMULATED payments (no real money moves). Every figure comes from stored records:
 *  - gross payment volume  = successful payments, by the time the money arrived (paid_at);
 *  - refunds               = refunds paid out, by processed_at;
 *  - platform commission / doctor earnings = the split SAVED when each payment succeeded
 *    (doctor_earnings), minus the share reversed by each refund (allocated from that same snapshot).
 * The current commission setting is never used for history.
 */

export const FinanceErrorCode = Object.freeze({
  RANGE_INVALID: 'FINANCE_RANGE_INVALID',
  COMMISSION_INVALID: 'COMMISSION_INVALID',
  COMMISSION_UNCHANGED: 'COMMISSION_UNCHANGED',
  REFUND_NOT_REVIEWABLE: 'REFUND_NOT_REVIEWABLE',
});

function rangeOf(query) {
  try {
    return resolveRange(query);
  } catch (error) {
    throw ApiError.badRequest(error.message, [{ path: 'range', message: error.message }], FinanceErrorCode.RANGE_INVALID);
  }
}

/**
 * Commission/doctor shares of the refunds paid out in the range, allocated cumulatively over ALL of
 * each payment's refunds (so a refund's share does not depend on the report window).
 */
async function refundAllocation(client, refundsInRange) {
  const paymentIds = [...new Set(refundsInRange.map((r) => r.paymentId))];
  const [all, earnings] = await Promise.all([repo.allSucceededRefundsForPayments(client, paymentIds), repo.earningsForAppointments(client, [...new Set(refundsInRange.map((r) => r.appointmentId))])]);
  const earningByAppointment = new Map(earnings.map((e) => [e.appointmentId, e]));
  const share = new Map();
  for (const paymentId of paymentIds) {
    const refunds = all.filter((r) => r.paymentId === paymentId);
    const earning = earningByAppointment.get(refunds[0]?.appointmentId);
    if (!earning) continue;
    allocateRefunds({ gross: earning.grossAmount, commission: earning.commissionAmount }, refunds.map((r) => r.amount)).forEach((a, i) => share.set(refunds[i].id, { ...a, doctorId: earning.doctorId }));
  }
  return share;
}

const sum = (rows, pick) => sumMoney(rows.map(pick));

/* ------------------------------------------------------------ overview */

/** GET /api/v1/admin/finance/overview: gross volume, refunds, net, platform and doctor earnings, counts by status and method. */
export async function overview(query = {}, client = prisma) {
  const range = rangeOf({ preset: 'all', ...query });
  const [payments, statusCounts, failedAttempts, refunds, refundCounts, open, earnings, setting] = await Promise.all([
    repo.succeededPayments(client, range),
    repo.paymentStatusCounts(client, range),
    repo.failedAttemptCount(client, range),
    repo.succeededRefunds(client, range),
    repo.refundStatusCounts(client, range),
    repo.openRefundTotals(client),
    repo.earningsInRange(client, range),
    repo.findSetting(client, SettingKey.commissionRate),
  ]);
  const shares = await refundAllocation(client, refunds);
  const gross = sum(payments, (p) => p.amount);
  const refunded = sum(refunds, (r) => r.amount);
  const commissionEarned = sum(earnings, (e) => e.commissionAmount);
  const doctorEarned = sum(earnings, (e) => e.netAmount);
  const commissionReversed = sumMoney(refunds.map((r) => shares.get(r.id)?.commission ?? 0));
  const doctorReversed = sumMoney(refunds.map((r) => shares.get(r.id)?.doctor ?? 0));
  const countOf = (status) => statusCounts.find((s) => s.status === status)?._count._all ?? 0;
  const refundCount = (status) => refundCounts.find((s) => s.status === status) ?? { _count: { _all: 0 }, _sum: { amount: null } };
  const byProvider = new Map();
  for (const p of payments) {
    const row = byProvider.get(p.provider) ?? { provider: p.provider, count: 0, amount: new Decimal(0) };
    row.count += 1;
    row.amount = row.amount.plus(p.amount);
    byProvider.set(p.provider, row);
  }
  const rate = setting?.value?.rate ?? null;
  return {
    simulated: true,
    currency: 'USD',
    range: describeRange(range),
    grossVolume: { amount: money(gross), count: payments.length },
    refunds: { amount: money(refunded), count: refunds.length },
    netAfterRefunds: money(gross.minus(refunded)),
    platformEarnings: { amount: money(commissionEarned.minus(commissionReversed)), beforeRefunds: money(commissionEarned), reversed: money(commissionReversed) },
    doctorEarnings: { amount: money(doctorEarned.minus(doctorReversed)), beforeRefunds: money(doctorEarned), reversed: money(doctorReversed) },
    successfulPayments: payments.length,
    pendingPayments: countOf('PENDING'),
    failedPayments: countOf('FAILED'),
    expiredOrCancelledPayments: countOf('CANCELLED'),
    failedAttempts,
    openRefunds: { amount: money(open._sum.amount), count: open._count._all },
    failedRefunds: { amount: money(refundCount('FAILED')._sum.amount), count: refundCount('FAILED')._count._all },
    rejectedRefunds: { amount: money(refundCount('REJECTED')._sum.amount), count: refundCount('REJECTED')._count._all },
    commissionRate: rate == null ? null : toDecimal(rate).toFixed(4),
    byProvider: [...byProvider.values()].map((p) => ({ provider: p.provider, count: p.count, amount: money(p.amount) })),
    // Compatibility with the earlier overview shape.
    revenue: { amount: money(gross), count: payments.length },
    net: money(gross.minus(refunded)),
    commission: { amount: money(commissionEarned.minus(commissionReversed)), rate: rate == null ? null : toDecimal(rate).toFixed(4) },
  };
}

/* ------------------------------------------------------------ refunds: review */

/** Administrator rejects a REQUESTED refund with a reason. The amount is released; no ledger entry. */
export async function rejectRefund({ refundId, adminUserId, reason, now = new Date() }, client = prisma) {
  await withTransaction(
    async (tx) => {
      if (!(await lockRow(tx, 'refunds', refundId))) throw ApiError.notFound('Refund not found');
      const refund = await refundRepository.findRefundById(tx, refundId);
      if (refund.status !== 'REQUESTED') throw ApiError.conflict(`Refund is already ${refund.status}`, { status: refund.status }, FinanceErrorCode.REFUND_NOT_REVIEWABLE);
      await refundRepository.updateRefund(tx, refundId, { status: 'REJECTED', reviewNote: reason, reviewedBy: adminUserId, reviewedAt: now, processedAt: now });
      await auditRepository.createAuditLog(tx, {
        actorUserId: adminUserId,
        action: 'REFUND',
        entityType: 'Refund',
        entityId: refundId,
        oldValues: { status: 'REQUESTED' },
        newValues: { status: 'REJECTED', amount: refund.amount.toString(), reason, simulated: true },
      });
      await notificationEvents.refundRejected(tx, refund);
    },
    { client },
  );
  return getRefund(refundId, client);
}

/** GET /api/v1/admin/finance/refunds/:id: one refund with its payment, appointment and audit history. */
export async function getRefund(refundId, client = prisma) {
  const r = await client.refund.findUnique({
    where: { id: refundId },
    include: {
      reviewer: { select: { fullName: true } },
      payment: { select: { id: true, provider: true, amount: true, currency: true, status: true, paidAt: true, patient: { select: { user: { select: { fullName: true } } } } } },
      appointment: { select: { id: true, status: true, startAtUtc: true, cancelledAt: true, cancellationReason: true, doctor: { select: { user: { select: { fullName: true } } } } } },
    },
  });
  if (!r) throw ApiError.notFound('Refund not found');
  const others = await client.refund.findMany({ where: { paymentId: r.paymentId }, select: { id: true, status: true, amount: true } });
  const committed = sumMoney(others.filter((o) => ['REQUESTED', 'PROCESSING', 'SUCCEEDED'].includes(o.status)).map((o) => o.amount));
  return {
    id: r.id,
    status: r.status,
    simulated: true,
    amount: money(r.amount),
    currency: r.currency,
    reason: r.reason,
    reference: r.providerReference,
    createdAt: r.createdAt.toISOString(),
    processedAt: r.processedAt?.toISOString() ?? null,
    review: r.reviewedAt ? { by: r.reviewer?.fullName ?? null, at: r.reviewedAt.toISOString(), note: r.reviewNote } : null,
    payment: { id: r.payment.id, provider: r.payment.provider, amount: money(r.payment.amount), status: r.payment.status, paidAt: r.payment.paidAt?.toISOString() ?? null, refundable: money(toDecimal(r.payment.amount).minus(committed)) },
    patient: { name: r.payment.patient.user.fullName },
    doctor: { name: r.appointment.doctor.user.fullName },
    appointment: { id: r.appointment.id, status: r.appointment.status, startAtUtc: r.appointment.startAtUtc.toISOString(), cancelledAt: r.appointment.cancelledAt?.toISOString() ?? null, cancellationReason: r.appointment.cancellationReason },
    history: (await repo.refundAudit(client, refundId)).map((l) => ({ status: l.newValues?.status ?? l.action, reason: l.newValues?.reason ?? l.newValues?.error ?? null, by: l.actor?.fullName ?? 'System', at: l.createdAt.toISOString() })),
  };
}

/* ------------------------------------------------------------ doctor earnings */

/**
 * Earnings per doctor for consultations PAID in the range, after any refunds of those consultations.
 * Calculated earnings only — Fogaan Dawo has no payout system, so nothing is reported as paid out.
 */
export async function doctorEarnings(query = {}, client = prisma) {
  const range = rangeOf(query);
  const earnings = await repo.earningsInRange(client, range, { q: query.q });
  const refunds = await repo.allSucceededRefundsForPayments(client, [...new Set(earnings.map((e) => e.appointment.payment?.id).filter(Boolean))]);
  const refundsByAppointment = new Map();
  for (const r of refunds) refundsByAppointment.set(r.appointmentId, [...(refundsByAppointment.get(r.appointmentId) ?? []), r.amount]);
  const byDoctor = new Map();
  for (const e of earnings) {
    const row = byDoctor.get(e.doctorId) ?? { doctor: { id: e.doctor.id, name: e.doctor.user.fullName }, items: [], completed: 0, statuses: {} };
    row.items.push({ gross: e.grossAmount, commission: e.commissionAmount, net: e.netAmount, refunds: refundsByAppointment.get(e.appointmentId) ?? [] });
    if (e.appointment.status === 'COMPLETED') row.completed += 1;
    row.statuses[e.status] = (row.statuses[e.status] ?? 0) + 1;
    byDoctor.set(e.doctorId, row);
  }
  const rows = [...byDoctor.values()]
    .map((r) => {
      const t = earningsTotals(r.items);
      return {
        doctor: r.doctor,
        paidConsultations: t.count,
        completedConsultations: r.completed,
        gross: t.gross,
        refunds: t.refunds,
        refundDeductions: t.doctorRefundDeductions,
        platformCommission: t.commission,
        netEarnings: t.doctorNet,
        settlement: { calculated: t.doctorNet, paidOut: null, payoutsSupported: false },
        statuses: r.statuses,
      };
    })
    .sort((a, b) => toDecimal(b.netEarnings).comparedTo(toDecimal(a.netEarnings)) || a.doctor.name.localeCompare(b.doctor.name));
  const totals = earningsTotals(earnings.map((e) => ({ gross: e.grossAmount, commission: e.commissionAmount, net: e.netAmount, refunds: refundsByAppointment.get(e.appointmentId) ?? [] })));
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  return { simulated: true, currency: 'USD', range: describeRange(range), totals, items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize, payoutsSupported: false };
}

/* ------------------------------------------------------------ reports */

const DAILY_LIMIT_DAYS = 92;

/** GET /api/v1/admin/finance/reports: revenue, refunds, commission, doctor earnings and daily/monthly trends for a range. */
export async function report(query = {}, client = prisma) {
  const range = rangeOf(query);
  const [payments, refunds, refundCounts, earnings] = await Promise.all([repo.succeededPayments(client, range), repo.succeededRefunds(client, range), repo.refundStatusCounts(client, range), repo.earningsInRange(client, range)]);
  const shares = await refundAllocation(client, refunds);
  const earningByAppointment = new Map(earnings.map((e) => [e.appointmentId, e]));
  const zero = () => ({ gross: new Decimal(0), refunds: new Decimal(0), commission: new Decimal(0), doctor: new Decimal(0), payments: 0, refundCount: 0 });
  const daily = new Map();
  const monthly = new Map();
  const bump = (map, key, fn) => {
    const row = map.get(key) ?? zero();
    fn(row);
    map.set(key, row);
  };
  for (const p of payments) {
    const e = earningByAppointment.get(p.appointmentId);
    const add = (row) => {
      row.gross = row.gross.plus(p.amount);
      row.payments += 1;
      if (e) {
        row.commission = row.commission.plus(e.commissionAmount);
        row.doctor = row.doctor.plus(e.netAmount);
      }
    };
    bump(daily, dayKey(p.paidAt, range.tz), add);
    bump(monthly, monthKey(p.paidAt, range.tz), add);
  }
  for (const r of refunds) {
    const s = shares.get(r.id);
    const add = (row) => {
      row.refunds = row.refunds.plus(r.amount);
      row.refundCount += 1;
      if (s) {
        row.commission = row.commission.minus(s.commission);
        row.doctor = row.doctor.minus(s.doctor);
      }
    };
    bump(daily, dayKey(r.processedAt, range.tz), add);
    bump(monthly, monthKey(r.processedAt, range.tz), add);
  }
  const series = (map) =>
    [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, v]) => ({ period, payments: v.payments, gross: money(v.gross), refunds: money(v.refunds), net: money(v.gross.minus(v.refunds)), commission: money(v.commission), doctorEarnings: money(v.doctor) }));

  const methods = new Map();
  for (const p of payments) bump(methods, p.provider, (row) => ((row.gross = row.gross.plus(p.amount)), (row.payments += 1)));
  for (const r of refunds) bump(methods, r.payment.provider, (row) => ((row.refunds = row.refunds.plus(r.amount)), (row.refundCount += 1)));

  const rates = new Map();
  for (const e of earnings) {
    const key = toDecimal(e.appointment.commissionRateSnapshot).toFixed(4);
    const row = rates.get(key) ?? { rate: key, count: 0, gross: new Decimal(0), commission: new Decimal(0) };
    row.count += 1;
    row.gross = row.gross.plus(e.grossAmount);
    row.commission = row.commission.plus(e.commissionAmount);
    rates.set(key, row);
  }

  const gross = sum(payments, (p) => p.amount);
  const refunded = sum(refunds, (r) => r.amount);
  const commissionBefore = sum(earnings, (e) => e.commissionAmount);
  const commissionReversed = sumMoney(refunds.map((r) => shares.get(r.id)?.commission ?? 0));
  const doctorBefore = sum(earnings, (e) => e.netAmount);
  const doctorReversed = sumMoney(refunds.map((r) => shares.get(r.id)?.doctor ?? 0));
  const days = range.from ? Math.round((range.to - range.from) / 86_400_000) : Infinity;
  const doctors = await doctorEarnings({ ...query, page: 1, pageSize: 10 }, client);

  return {
    simulated: true,
    currency: 'USD',
    range: describeRange(range),
    revenue: { grossVolume: money(gross), payments: payments.length, refunds: money(refunded), netAfterRefunds: money(gross.minus(refunded)) },
    byMethod: [...methods.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([provider, v]) => ({ provider, payments: v.payments, gross: money(v.gross), refunds: money(v.refunds), refundCount: v.refundCount })),
    refundSummary: {
      paidOut: { amount: money(refunded), count: refunds.length },
      byStatus: refundCounts.map((c) => ({ status: c.status, count: c._count._all, amount: money(c._sum.amount) })).sort((a, b) => a.status.localeCompare(b.status)),
    },
    commission: {
      beforeRefunds: money(commissionBefore),
      reversedByRefunds: money(commissionReversed),
      net: money(commissionBefore.minus(commissionReversed)),
      byRate: [...rates.values()].sort((a, b) => a.rate.localeCompare(b.rate)).map((r) => ({ rate: r.rate, percent: percentFromFraction(r.rate), consultations: r.count, gross: money(r.gross), commission: money(r.commission) })),
    },
    doctorEarnings: { beforeRefunds: money(doctorBefore), reversedByRefunds: money(doctorReversed), net: money(doctorBefore.minus(doctorReversed)), topDoctors: doctors.items, payoutsSupported: false },
    trends: { daily: days <= DAILY_LIMIT_DAYS ? series(daily) : null, monthly: series(monthly) },
  };
}

/* ------------------------------------------------------------ CSV export */

/** CSV cell: quoted, and formula-looking values neutralised (spreadsheet injection). */
export function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
const csv = (header, rows) => `﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** GET /api/v1/admin/finance/reports/export: CSV of the chosen report (formula-safe cells, no contact details). */
export async function exportCsv(query, client = prisma) {
  const range = rangeOf(query);
  const stamp = range.fromDate ? `${range.fromDate}_${range.toDate}` : 'all-time';
  switch (query.type) {
    case 'payments': {
      const rows = await client.payment.findMany({
        where: range.from ? { createdAt: { gte: range.from, lt: range.to } } : {},
        orderBy: { createdAt: 'asc' },
        select: { id: true, provider: true, amount: true, currency: true, status: true, createdAt: true, paidAt: true, appointmentId: true, attempts: { where: { status: 'SUCCEEDED' }, select: { providerReference: true } }, appointment: { select: { doctor: { select: { user: { select: { fullName: true } } } } } }, refunds: { select: { status: true, amount: true } } },
      });
      return {
        filename: `fogaan-dawo-payments_${stamp}.csv`,
        body: csv(
          ['payment_id', 'reference', 'appointment_id', 'doctor', 'method', 'amount', 'currency', 'status', 'created_at_utc', 'paid_at_utc', 'refunded_amount', 'simulated'],
          rows.map((p) => [p.id, p.attempts[0]?.providerReference ?? '', p.appointmentId ?? '', p.appointment?.doctor.user.fullName ?? '', p.provider, money(p.amount), p.currency, p.status, p.createdAt.toISOString(), p.paidAt?.toISOString() ?? '', money(sumMoney(p.refunds.filter((r) => r.status === 'SUCCEEDED').map((r) => r.amount))), 'yes']),
        ),
      };
    }
    case 'refunds': {
      const rows = await client.refund.findMany({
        where: range.from ? { createdAt: { gte: range.from, lt: range.to } } : {},
        orderBy: { createdAt: 'asc' },
        select: { id: true, paymentId: true, appointmentId: true, amount: true, currency: true, status: true, createdAt: true, processedAt: true, providerReference: true, reviewedAt: true, payment: { select: { provider: true } } },
      });
      return {
        filename: `fogaan-dawo-refunds_${stamp}.csv`,
        body: csv(['refund_id', 'payment_id', 'appointment_id', 'method', 'amount', 'currency', 'status', 'requested_at_utc', 'processed_at_utc', 'reviewed_at_utc', 'reference', 'simulated'], rows.map((r) => [r.id, r.paymentId, r.appointmentId, r.payment.provider, money(r.amount), r.currency, r.status, r.createdAt.toISOString(), r.processedAt?.toISOString() ?? '', r.reviewedAt?.toISOString() ?? '', r.providerReference ?? '', 'yes'])),
      };
    }
    case 'doctor-earnings': {
      const data = await doctorEarnings({ ...query, page: 1, pageSize: 10_000 }, client);
      return {
        filename: `fogaan-dawo-doctor-earnings_${stamp}.csv`,
        body: csv(['doctor', 'paid_consultations', 'completed_consultations', 'gross', 'refunds', 'refund_deductions', 'platform_commission', 'net_earnings_calculated', 'paid_out', 'currency'], data.items.map((r) => [r.doctor.name, r.paidConsultations, r.completedConsultations, r.gross, r.refunds, r.refundDeductions, r.platformCommission, r.netEarnings, 'not supported', 'USD'])),
      };
    }
    default: {
      const data = await report(query, client);
      const rows = data.trends.daily ?? data.trends.monthly;
      return {
        filename: `fogaan-dawo-financial-summary_${stamp}.csv`,
        body: csv(['period', 'payments', 'gross_volume', 'refunds', 'net_after_refunds', 'platform_commission', 'doctor_earnings', 'currency'], rows.map((r) => [r.period, r.payments, r.gross, r.refunds, r.net, r.commission, r.doctorEarnings, 'USD'])),
      };
    }
  }
}

/* ------------------------------------------------------------ commission setting */

/** GET /api/v1/admin/finance/settings: current commission rate and its change history. */
export async function getSettings(client = prisma) {
  const setting = await repo.findSetting(client, SettingKey.commissionRate);
  const rate = setting?.value?.rate ?? null;
  const history = await repo.settingHistory(client, SettingKey.commissionRate);
  return {
    commission: {
      rate: rate == null ? null : toDecimal(rate).toFixed(4),
      percent: rate == null ? null : percentFromFraction(rate),
      updatedAt: setting?.updatedAt?.toISOString() ?? null,
      updatedBy: setting?.updatedByUser?.fullName ?? null,
    },
    history: history.map((h) => ({ from: h.oldValues?.rate ?? null, to: h.newValues?.rate ?? null, fromPercent: h.oldValues?.rate == null ? null : percentFromFraction(h.oldValues.rate), toPercent: h.newValues?.rate == null ? null : percentFromFraction(h.newValues.rate), by: h.actor?.fullName ?? 'System', at: h.createdAt.toISOString() })),
    note: 'Applies to bookings made after the change. Existing bookings keep the rate saved when they were booked.',
  };
}

/**
 * Changes the platform commission (percent 0–100). Applies to NEW reservations only: every appointment
 * keeps its saved rate snapshot and every payment its saved split, so history never changes.
 */
export async function updateCommission({ adminUserId, percent }, client = prisma) {
  let fraction;
  try {
    fraction = commissionFractionFromPercent(percent);
  } catch (error) {
    throw ApiError.badRequest(error.message, [{ path: 'percent', message: error.message }], FinanceErrorCode.COMMISSION_INVALID);
  }
  await withTransaction(
    async (tx) => {
      // Serialise concurrent changes of this setting.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext('platform_settings:commission_rate'))`;
      const current = await tx.platformSetting.findUnique({ where: { key: SettingKey.commissionRate } });
      const previous = current?.value?.rate == null ? null : toDecimal(current.value.rate).toFixed(4);
      if (previous === fraction) throw ApiError.conflict('The commission is already set to this rate', undefined, FinanceErrorCode.COMMISSION_UNCHANGED);
      await tx.platformSetting.upsert({
        where: { key: SettingKey.commissionRate },
        create: { key: SettingKey.commissionRate, value: { rate: fraction }, description: 'Platform commission (fraction of the consultation fee)', updatedBy: adminUserId },
        update: { value: { rate: fraction }, updatedBy: adminUserId },
      });
      await auditRepository.createAuditLog(tx, { actorUserId: adminUserId, action: 'UPDATE', entityType: 'PlatformSetting', entityId: SettingKey.commissionRate, oldValues: { rate: previous }, newValues: { rate: fraction } });
    },
    { client },
  );
  return getSettings(client);
}
