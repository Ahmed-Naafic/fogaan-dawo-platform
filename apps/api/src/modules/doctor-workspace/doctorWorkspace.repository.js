import { inRange } from '../finance/finance.dates.js';

/** Data access for the doctor's own workspace. Every query is scoped to one doctor id. */

/** Upper bound on the appointments aggregated per request (a doctor's whole book, far above real use). */
const MAX_APPOINTMENTS = 10_000;

/**
 * The doctor's appointments in `statuses`, optionally only with patients whose name matches `q`.
 * Minimal fields: enough to group by patient (counts, last/next visit, the authorising appointment).
 */
export const appointmentsForDoctor = (client, { doctorId, statuses, q }) =>
  client.appointment.findMany({
    where: { doctorId, status: { in: statuses }, ...(q ? { patient: { user: { fullName: { contains: q, mode: 'insensitive' } } } } : {}) },
    select: { id: true, patientId: true, status: true, startAtUtc: true, endAtUtc: true },
    orderBy: { startAtUtc: 'desc' },
    take: MAX_APPOINTMENTS,
  });

/** Names of the given patients (and the photo version only, never the storage key). */
export const patientNames = (client, patientIds) =>
  patientIds.length
    ? client.patientProfile.findMany({ where: { id: { in: patientIds } }, select: { id: true, user: { select: { fullName: true, avatarUpdatedAt: true } } } })
    : [];

/** Every appointment of this doctor with this patient (any status), newest first. */
export const appointmentsWithPatient = (client, { doctorId, patientId }) =>
  client.appointment.findMany({
    where: { doctorId, patientId },
    select: { id: true, status: true, startAtUtc: true, endAtUtc: true, reason: true, bookingType: true, originalAppointmentId: true },
    orderBy: { startAtUtc: 'desc' },
    take: 200,
  });

/** The doctor's earning snapshots created (= payment succeeded) in the range, newest first. */
export const earningsForDoctor = (client, { doctorId, range, status }) =>
  client.doctorEarning.findMany({
    where: { doctorId, ...(range.from ? { createdAt: inRange(range) } : {}), ...(status ? { status } : {}) },
    select: {
      id: true,
      appointmentId: true,
      grossAmount: true,
      commissionAmount: true,
      netAmount: true,
      currency: true,
      status: true,
      createdAt: true,
      appointment: { select: { status: true, startAtUtc: true, patient: { select: { user: { select: { fullName: true } } } }, payment: { select: { id: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });

/** Earning count per status for the doctor in the range (ignores the status filter). */
export const earningStatusCounts = (client, { doctorId, range }) =>
  client.doctorEarning.groupBy({ by: ['status'], where: { doctorId, ...(range.from ? { createdAt: inRange(range) } : {}) }, _count: { _all: true } });
