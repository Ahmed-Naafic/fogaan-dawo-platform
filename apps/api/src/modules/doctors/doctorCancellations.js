import * as auditRepository from '../audit/audit.repository.js';
import * as notificationEvents from '../notifications/notification.events.js';

/**
 * Requirement 11: a doctor who cancels more than 3 times in a calendar month is flagged for Admin.
 * Doctor cancellations are recognised by the reason prefix written by the doctor-cancel flow. The month is
 * the calendar month in UTC. The flag is computed on read (Admin › Doctors) and, when a cancellation
 * crosses the threshold, admins are notified once and the event is audited.
 */
export const DOCTOR_CANCEL_FLAG_THRESHOLD = 3;
export const DOCTOR_CANCEL_REASON_PREFIX = 'Cancelled by the doctor';

/** Start and end (UTC) of the calendar month containing `now`. */
export function monthBounds(now = new Date()) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from, to };
}

/** Map doctorId → number of doctor cancellations in the current UTC month. */
export async function doctorCancellationsThisMonth(client, doctorIds, now = new Date()) {
  if (doctorIds.length === 0) return new Map();
  const { from, to } = monthBounds(now);
  const rows = await client.appointment.groupBy({
    by: ['doctorId'],
    where: { doctorId: { in: doctorIds }, status: 'CANCELLED', cancelledAt: { gte: from, lt: to }, cancellationReason: { startsWith: DOCTOR_CANCEL_REASON_PREFIX } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.doctorId, r._count._all]));
}

/** True when a doctor's cancellations this month exceed the threshold (more than 3). */
export const isFlagged = (count) => count > DOCTOR_CANCEL_FLAG_THRESHOLD;

/** Called inside the doctor-cancel transaction: notifies admins + audits exactly when the count first exceeds 3. */
export async function checkDoctorCancellationFlag(tx, { doctorId, actorUserId, now = new Date() }) {
  const count = (await doctorCancellationsThisMonth(tx, [doctorId], now)).get(doctorId) ?? 0;
  if (count !== DOCTOR_CANCEL_FLAG_THRESHOLD + 1) return { count, flagged: isFlagged(count) };
  const doctor = await tx.doctorProfile.findUnique({ where: { id: doctorId }, select: { user: { select: { fullName: true } } } });
  await notificationEvents.doctorCancellationsFlagged(tx, { doctorId, doctorName: doctor?.user.fullName ?? '', count, month: monthBounds(now).from.toISOString().slice(0, 7) });
  await auditRepository.createAuditLog(tx, { actorUserId, action: 'OTHER', entityType: 'DoctorProfile', entityId: doctorId, newValues: { reason: 'CANCELLATIONS_FLAGGED', count } });
  return { count, flagged: true };
}
