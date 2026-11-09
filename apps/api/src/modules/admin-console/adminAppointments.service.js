import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { money } from '../finance/finance.calc.js';
import { describeRange, inRange } from '../finance/finance.dates.js';
import { resolveAdminRange } from './adminRange.js';

/**
 * Admin › Appointments: read-only monitoring of every booking. Shows who, when, status history, payment,
 * refunds and the consultation's timing. Never the patient's reason for the visit, consultation notes,
 * messages, prescriptions or documents. Refund actions stay in Admin › Finance.
 */

function whereFor({ range, status, q }) {
  return {
    ...(range.from ? { startAtUtc: inRange(range) } : {}),
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { patient: { user: { fullName: { contains: q, mode: 'insensitive' } } } },
            { doctor: { user: { fullName: { contains: q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };
}

const LIST_SELECT = {
  id: true,
  status: true,
  bookingType: true,
  startAtUtc: true,
  endAtUtc: true,
  feeAmount: true,
  currency: true,
  originalAppointmentId: true,
  createdAt: true,
  patient: { select: { id: true, user: { select: { fullName: true } } } },
  doctor: { select: { id: true, user: { select: { fullName: true } }, specialty: { select: { nameEn: true, nameSo: true } } } },
  payment: { select: { status: true } },
};

const presentItem = (a) => ({
  id: a.id,
  status: a.status,
  bookingType: a.bookingType,
  startAtUtc: a.startAtUtc.toISOString(),
  endAtUtc: a.endAtUtc.toISOString(),
  fee: money(a.feeAmount),
  currency: a.currency,
  rescheduled: !!a.originalAppointmentId,
  bookedAt: a.createdAt.toISOString(),
  paymentStatus: a.payment?.status ?? null,
  patient: { id: a.patient.id, name: a.patient.user.fullName },
  doctor: { id: a.doctor.id, name: a.doctor.user.fullName, specialty: a.doctor.specialty },
});

/** GET /api/v1/admin/appointments?preset=&fromDate=&toDate=&tz=&status=&q=&page=&pageSize= (range = start time) */
export async function listAppointments(query = {}, client = prisma) {
  const range = resolveAdminRange(query, 'all');
  const where = whereFor({ range, status: query.status, q: query.q });
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const [rows, total, byStatus] = await Promise.all([
    client.appointment.findMany({ where, select: LIST_SELECT, orderBy: { startAtUtc: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    client.appointment.count({ where }),
    client.appointment.groupBy({ by: ['status'], where: whereFor({ range, q: query.q }), _count: { _all: true } }),
  ]);
  return {
    range: describeRange(range),
    statusCounts: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
    items: rows.map(presentItem),
    total,
    page,
    pageSize,
  };
}

/** GET /api/v1/admin/appointments/:appointmentId */
export async function getAppointment(appointmentId, client = prisma) {
  const a = await client.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      ...LIST_SELECT,
      cancellationReason: true,
      cancelledAt: true,
      rescheduleCount: true,
      holdExpiresAt: true,
      commissionRateSnapshot: true,
      statusHistory: { orderBy: { createdAt: 'asc' }, select: { fromStatus: true, toStatus: true, reason: true, createdAt: true, changedByUser: { select: { fullName: true } } } },
      payment: { select: { id: true, status: true, amount: true, currency: true, provider: true, paidAt: true } },
      refunds: { orderBy: { createdAt: 'asc' }, select: { id: true, amount: true, status: true, createdAt: true, processedAt: true } },
      consultation: { select: { id: true, status: true, startedAt: true, endedAt: true } },
      earning: { select: { grossAmount: true, commissionAmount: true, netAmount: true, status: true } },
    },
  });
  if (!a) throw ApiError.notFound('Appointment not found');
  return {
    ...presentItem(a),
    cancellationReason: a.cancellationReason ?? null,
    cancelledAt: a.cancelledAt?.toISOString() ?? null,
    rescheduleCount: a.rescheduleCount,
    commissionRate: a.commissionRateSnapshot.toFixed(4),
    statusHistory: a.statusHistory.map((h) => ({ from: h.fromStatus, to: h.toStatus, reason: h.reason ?? null, at: h.createdAt.toISOString(), by: h.changedByUser?.fullName ?? null })),
    payment: a.payment ? { id: a.payment.id, status: a.payment.status, amount: money(a.payment.amount), currency: a.payment.currency, provider: a.payment.provider, paidAt: a.payment.paidAt?.toISOString() ?? null } : null,
    refunds: a.refunds.map((r) => ({ id: r.id, amount: money(r.amount), status: r.status, requestedAt: r.createdAt.toISOString(), processedAt: r.processedAt?.toISOString() ?? null })),
    consultation: a.consultation ? { id: a.consultation.id, status: a.consultation.status, startedAt: a.consultation.startedAt?.toISOString() ?? null, endedAt: a.consultation.endedAt?.toISOString() ?? null } : null,
    earning: a.earning ? { gross: money(a.earning.grossAmount), commission: money(a.earning.commissionAmount), net: money(a.earning.netAmount), status: a.earning.status } : null,
  };
}
