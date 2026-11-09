import { tableSql } from '../../utils/sql.js';

/** Data access for slots, appointments and status history. Writes must run inside a transaction. */

/** Data access: find slot by id (availabilitySlot.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findSlotById = (client, id) => client.availabilitySlot.findUnique({ where: { id } });

/** Data access: set slot status (availabilitySlot.update: updates a row). `client` is the Prisma client or a transaction. */
export const setSlotStatus = (client, slotId, status, holdExpiresAt = null) =>
  client.availabilitySlot.update({ where: { id: slotId }, data: { status, holdExpiresAt } });

/** Data access: find pending appointment for slot (appointment.findFirst: first matching row). `client` is the Prisma client or a transaction. */
export const findPendingAppointmentForSlot = (client, slotId) =>
  client.appointment.findFirst({ where: { slotId, status: 'PENDING_PAYMENT' } });

/** Data access: find appointment by id (appointment.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findAppointmentById = (client, id) => client.appointment.findUnique({ where: { id } });

/** Data access: create appointment (appointment.create: inserts a row). `client` is the Prisma client or a transaction. */
export const createAppointment = (client, data) => client.appointment.create({ data });

/** Data access: update appointment (appointment.update: updates a row). `client` is the Prisma client or a transaction. */
export const updateAppointment = (client, id, data) => client.appointment.update({ where: { id }, data });

/** Future appointments of a doctor in the given statuses, with payment and patient user id. */
export const findFutureAppointmentsForDoctor = (client, { doctorId, after, statuses }) =>
  client.appointment.findMany({
    where: { doctorId, startAtUtc: { gt: after }, status: { in: statuses } },
    include: { payment: true, patient: { select: { userId: true } } },
    orderBy: { startAtUtc: 'asc' },
  });

/** Data access: record status change (appointmentStatusHistory.create: inserts a row). `client` is the Prisma client or a transaction. */
export const recordStatusChange = (client, { appointmentId, fromStatus, toStatus, reason = null, changedBy = null }) =>
  client.appointmentStatusHistory.create({ data: { appointmentId, fromStatus, toStatus, reason, changedBy } });

/** Pending appointments past their deadline; locked, skipping rows another worker already holds. */
export const lockExpiredHolds = (client, now, limit) => client.$queryRaw`
  SELECT id FROM ${tableSql('appointments')}
  WHERE status = 'PENDING_PAYMENT' AND hold_expires_at <= ${now}
  ORDER BY hold_expires_at
  LIMIT ${limit}
  FOR UPDATE SKIP LOCKED`;

/* ---------------------------------------------------------------- booking views */

const ACTIVE = ['PENDING_PAYMENT', 'CONFIRMED', 'WAITING', 'IN_PROGRESS'];

/** "upcoming" = active and not finished (an unpaid hold past its deadline is not upcoming); "past" = the rest. */
const scopeWhere = (scope, now) =>
  scope === 'upcoming'
    ? { status: { in: ACTIVE }, endAtUtc: { gt: now }, NOT: { status: 'PENDING_PAYMENT', holdExpiresAt: { lte: now } } }
    : { OR: [{ status: { notIn: ACTIVE } }, { endAtUtc: { lte: now } }, { status: 'PENDING_PAYMENT', holdExpiresAt: { lte: now } }] };

const DOCTOR_SELECT = { id: true, userId: true, consultationFee: true, specialty: { select: { id: true, nameEn: true, nameSo: true } }, user: { select: { fullName: true, timeZone: true } } };
// avatarUpdatedAt only versions the doctor's gated patient-photo URL; the storage key is never selected.
const PATIENT_SELECT = { id: true, userId: true, user: { select: { fullName: true, avatarUpdatedAt: true } } };

/** Data access: list appointments (appointment.findMany: matching rows). `client` is the Prisma client or a transaction. */
export const listAppointments = (client, { patientId, doctorId, scope, now, take = 50 }) =>
  client.appointment.findMany({
    where: { ...(patientId ? { patientId } : {}), ...(doctorId ? { doctorId } : {}), ...scopeWhere(scope, now) },
    include: { doctor: { select: DOCTOR_SELECT }, patient: { select: PATIENT_SELECT } },
    orderBy: { startAtUtc: scope === 'upcoming' ? 'asc' : 'desc' },
    take,
  });

/** Data access: find appointment detail (appointment.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findAppointmentDetail = (client, id) =>
  client.appointment.findUnique({
    where: { id },
    include: {
      doctor: { select: DOCTOR_SELECT },
      patient: { select: PATIENT_SELECT },
      statusHistory: { orderBy: { createdAt: 'asc' }, select: { fromStatus: true, toStatus: true, reason: true, createdAt: true } },
      originalAppointment: { select: { id: true, startAtUtc: true } },
      rescheduledAppointments: { select: { id: true, startAtUtc: true, status: true } },
      consultation: { select: { id: true, status: true } },
    },
  });

/** Data access: find patient by user id (patientProfile.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findPatientByUserId = (client, userId) => client.patientProfile.findUnique({ where: { userId } });

/** Data access: find doctor by user id (doctorProfile.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findDoctorByUserId = (client, userId) => client.doctorProfile.findUnique({ where: { userId } });

/** Data access: find refunds for appointments (refund.findMany: matching rows). `client` is the Prisma client or a transaction. */
export const findRefundsForAppointments = (client, appointmentIds) =>
  client.refund.findMany({
    where: { appointmentId: { in: appointmentIds } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, amount: true, currency: true, status: true, reason: true, createdAt: true },
  });
