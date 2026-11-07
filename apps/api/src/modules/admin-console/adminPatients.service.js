import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { sumMoney } from '../../utils/money.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as appointmentRepository from '../appointments/appointment.repository.js';
import * as auditRepository from '../audit/audit.repository.js';
import * as authRepository from '../auth/auth.repository.js';
import { SUSPENSION_CANCELLABLE_STATUSES } from '../doctors/doctor.constants.js';
import { money } from '../finance/finance.calc.js';
import * as notificationEvents from '../notifications/notification.events.js';
import { cancelRemindersForAppointment } from '../notifications/reminder.service.js';
import { createRefundRequest } from '../refunds/refund.service.js';
import { PATIENT_TABS } from './adminConsole.validation.js';

/**
 * Admin › Patients: account-level administration only. Name, contact, sign-up/last sign-in, status,
 * appointments and payments. Never date of birth, sex, address, emergency contact, medical history,
 * documents or prescriptions — clinical data stays with the patient and their assigned doctors.
 */

export const AdminPatientErrorCode = Object.freeze({
  ALREADY_SUSPENDED: 'PATIENT_ALREADY_SUSPENDED',
  NOT_SUSPENDED: 'PATIENT_NOT_SUSPENDED',
  PROTECTED_ACCOUNT: 'PATIENT_ACCOUNT_PROTECTED',
  ACTIVE_DOCTOR: 'PATIENT_IS_ACTIVE_DOCTOR',
});

const TAB_WHERE = Object.freeze({ all: {}, active: { user: { status: 'ACTIVE' } }, suspended: { user: { status: { not: 'ACTIVE' } } } });

function whereFor({ tab = 'all', q }) {
  const search = q
    ? { user: { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }] } }
    : {};
  return { AND: [TAB_WHERE[tab], search] };
}

const USER_SELECT = { id: true, fullName: true, email: true, phone: true, status: true, createdAt: true, lastLoginAt: true, preferredLanguage: true };

async function latestStatusChanges(client, userIds) {
  if (userIds.length === 0) return new Map();
  const logs = await client.auditLog.findMany({
    where: { entityType: 'PatientAccount', entityId: { in: userIds }, action: 'SUSPEND' },
    orderBy: { createdAt: 'desc' },
    select: { entityId: true, newValues: true, createdAt: true, actor: { select: { fullName: true } } },
  });
  const latest = new Map();
  for (const l of logs) if (!latest.has(l.entityId)) latest.set(l.entityId, l);
  return latest;
}

function presentRow(p, { appointments = 0, paid = '0.00' } = {}, suspension = null) {
  return {
    patientId: p.id,
    userId: p.user.id,
    name: p.user.fullName,
    email: p.user.email,
    phone: p.user.phone,
    status: p.user.status,
    registeredAt: p.user.createdAt.toISOString(),
    lastLoginAt: p.user.lastLoginAt?.toISOString() ?? null,
    appointments,
    totalPaid: paid,
    suspension: p.user.status !== 'ACTIVE' && suspension ? { reason: suspension.newValues?.reason ?? null, at: suspension.createdAt.toISOString(), by: suspension.actor?.fullName ?? null } : null,
  };
}

/** GET /api/v1/admin/patients?tab=&q=&page=&pageSize= */
export async function listPatients({ tab = 'all', q, page = 1, pageSize = 20 }, client = prisma) {
  const where = whereFor({ tab, q });
  const [rows, total, ...counts] = await Promise.all([
    client.patientProfile.findMany({ where, select: { id: true, user: { select: USER_SELECT } }, orderBy: { user: { createdAt: 'desc' } }, skip: (page - 1) * pageSize, take: pageSize }),
    client.patientProfile.count({ where }),
    ...PATIENT_TABS.map((name) => client.patientProfile.count({ where: whereFor({ tab: name }) })),
  ]);
  const ids = rows.map((r) => r.id);
  const [apptCounts, payments, suspensions] = await Promise.all([
    ids.length ? client.appointment.groupBy({ by: ['patientId'], where: { patientId: { in: ids } }, _count: { _all: true } }) : [],
    ids.length ? client.payment.groupBy({ by: ['patientId'], where: { patientId: { in: ids }, status: 'SUCCEEDED' }, _sum: { amount: true } }) : [],
    latestStatusChanges(client, rows.filter((r) => r.user.status !== 'ACTIVE').map((r) => r.user.id)),
  ]);
  const apptBy = new Map(apptCounts.map((c) => [c.patientId, c._count._all]));
  const paidBy = new Map(payments.map((c) => [c.patientId, money(c._sum.amount)]));
  return {
    tab,
    counts: Object.fromEntries(PATIENT_TABS.map((name, i) => [name, counts[i]])),
    items: rows.map((r) => presentRow(r, { appointments: apptBy.get(r.id) ?? 0, paid: paidBy.get(r.id) ?? '0.00' }, suspensions.get(r.user.id))),
    total,
    page,
    pageSize,
  };
}

async function findPatient(client, patientId) {
  return client.patientProfile.findUnique({
    where: { id: patientId },
    select: {
      id: true,
      user: { select: { ...USER_SELECT, roles: { select: { role: { select: { name: true } } } }, doctorProfile: { select: { id: true, verificationStatus: true, accountStatus: true } } } },
    },
  });
}

/** GET /api/v1/admin/patients/:patientId — account, appointments and payments (no clinical data). */
export async function getPatient(patientId, client = prisma) {
  const p = await findPatient(client, patientId);
  if (!p) throw ApiError.notFound('Patient not found');
  const [appointments, payments, suspensions, apptTotal] = await Promise.all([
    client.appointment.findMany({
      where: { patientId },
      orderBy: { startAtUtc: 'desc' },
      take: 50,
      select: { id: true, status: true, startAtUtc: true, endAtUtc: true, feeAmount: true, currency: true, doctor: { select: { id: true, user: { select: { fullName: true } } } } },
    }),
    client.payment.findMany({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, appointmentId: true, amount: true, currency: true, status: true, provider: true, paidAt: true, createdAt: true, refunds: { where: { status: 'SUCCEEDED' }, select: { amount: true } } },
    }),
    latestStatusChanges(client, [p.user.id]),
    client.appointment.count({ where: { patientId } }),
  ]);
  const paidTotal = sumMoney(payments.filter((x) => x.status === 'SUCCEEDED').map((x) => x.amount));
  const roles = p.user.roles.map((r) => r.role.name).sort();
  return {
    patient: {
      ...presentRow(p, { appointments: apptTotal, paid: money(paidTotal) }, suspensions.get(p.user.id)),
      preferredLanguage: p.user.preferredLanguage,
      roles,
      isDoctor: Boolean(p.user.doctorProfile),
      canSuspend: suspendBlocker(p) === null && p.user.status === 'ACTIVE',
      suspendBlocker: suspendBlocker(p),
    },
    appointments: appointments.map((a) => ({
      id: a.id,
      status: a.status,
      startAtUtc: a.startAtUtc.toISOString(),
      endAtUtc: a.endAtUtc.toISOString(),
      fee: money(a.feeAmount),
      currency: a.currency,
      doctor: { id: a.doctor.id, name: a.doctor.user.fullName },
    })),
    payments: payments.map((x) => ({
      id: x.id,
      appointmentId: x.appointmentId,
      amount: money(x.amount),
      refunded: money(sumMoney(x.refunds.map((r) => r.amount))),
      currency: x.currency,
      status: x.status,
      provider: x.provider,
      paidAt: x.paidAt?.toISOString() ?? null,
      createdAt: x.createdAt.toISOString(),
    })),
  };
}

/**
 * Why this account cannot be suspended from Admin › Patients, or null. Administrators are never
 * suspended here; a working doctor must be suspended from Admin › Doctors first (that flow cancels and
 * refunds their own appointments — suspending only the login would strand their patients).
 */
function suspendBlocker(p) {
  const roles = p.user.roles.map((r) => r.role.name);
  if (roles.includes('ADMIN')) return AdminPatientErrorCode.PROTECTED_ACCOUNT;
  const d = p.user.doctorProfile;
  if (d && d.verificationStatus === 'VERIFIED' && d.accountStatus === 'ACTIVE') return AdminPatientErrorCode.ACTIVE_DOCTOR;
  return null;
}

/**
 * POST /api/v1/admin/patients/:patientId/suspend. In one transaction: the account becomes SUSPENDED
 * (every request re-checks this, so access stops at once) and all sessions are revoked; every future
 * appointment still pending, confirmed or waiting is CANCELLED (slot released for others, status history,
 * reminders cancelled, the doctor notified); paid ones get a full refund request; audited.
 */
export async function suspendPatient({ patientId, adminUserId, reason, now = new Date() }) {
  return withTransaction(
    async (tx) => {
      const p = await findPatient(tx, patientId);
      if (!p) throw ApiError.notFound('Patient not found');
      if (!(await lockRow(tx, 'users', p.user.id))) throw ApiError.notFound('Patient not found');
      if (p.user.id === adminUserId) throw ApiError.forbidden('You cannot suspend your own account', undefined, 'SELF_ACTION_FORBIDDEN');
      const blocker = suspendBlocker(p);
      if (blocker === AdminPatientErrorCode.PROTECTED_ACCOUNT) throw ApiError.forbidden('Administrator accounts cannot be suspended here', undefined, blocker);
      if (blocker === AdminPatientErrorCode.ACTIVE_DOCTOR) throw ApiError.conflict('This person is an active doctor. Suspend them from Admin › Doctors first.', undefined, blocker);
      if (p.user.status !== 'ACTIVE') throw ApiError.conflict('This account is already suspended', undefined, AdminPatientErrorCode.ALREADY_SUSPENDED);

      await tx.user.update({ where: { id: p.user.id }, data: { status: 'SUSPENDED' } });
      const sessions = await authRepository.revokeActiveSessionsForUser(tx, p.user.id, now);

      const appointments = await tx.appointment.findMany({
        where: { patientId, startAtUtc: { gt: now }, status: { in: SUSPENSION_CANCELLABLE_STATUSES } },
        include: { payment: true },
        orderBy: { startAtUtc: 'asc' },
      });
      const refunds = [];
      for (const appointment of appointments) {
        await lockRow(tx, 'appointments', appointment.id);
        await appointmentRepository.updateAppointment(tx, appointment.id, { status: 'CANCELLED', cancelledAt: now, cancellationReason: `Patient account suspended: ${reason}`, holdExpiresAt: null });
        await appointmentRepository.recordStatusChange(tx, { appointmentId: appointment.id, fromStatus: appointment.status, toStatus: 'CANCELLED', reason: 'Patient account suspended', changedBy: adminUserId });
        // The slot goes back on sale: the doctor did nothing wrong.
        await lockRow(tx, 'availability_slots', appointment.slotId);
        await appointmentRepository.setSlotStatus(tx, appointment.slotId, appointment.startAtUtc > now ? 'AVAILABLE' : 'CANCELLED');
        await cancelRemindersForAppointment(tx, appointment.id);
        let refund = null;
        if (appointment.payment?.status === 'SUCCEEDED') refunds.push((refund = await createRefundRequest(tx, { appointmentId: appointment.id, reason: 'Patient account suspended — full refund' })));
        if (refund) await notificationEvents.refundRequested(tx, refund);
        // by PATIENT: the doctor is told (if it was confirmed); the suspended patient is not notified in-app.
        await notificationEvents.appointmentCancelled(tx, { appointmentId: appointment.id, by: 'PATIENT', wasConfirmed: appointment.status === 'CONFIRMED', refund: Boolean(refund) });
      }

      await auditRepository.createAuditLog(tx, {
        actorUserId: adminUserId,
        action: 'SUSPEND',
        entityType: 'PatientAccount',
        entityId: p.user.id,
        oldValues: { status: p.user.status },
        newValues: { status: 'SUSPENDED', reason, patientId, cancelledAppointments: appointments.length, refundRequests: refunds.length, sessionsRevoked: sessions.count },
      });
      return { cancelledAppointments: appointments.length, refundRequests: refunds.length };
    },
    { timeout: 60_000 },
  );
}

/** POST /api/v1/admin/patients/:patientId/reactivate — ACTIVE again (cancelled appointments stay cancelled). */
export async function reactivatePatient({ patientId, adminUserId, reason = null }) {
  return withTransaction(async (tx) => {
    const p = await findPatient(tx, patientId);
    if (!p) throw ApiError.notFound('Patient not found');
    await lockRow(tx, 'users', p.user.id);
    if (p.user.status !== 'SUSPENDED') throw ApiError.conflict('This account is not suspended', undefined, AdminPatientErrorCode.NOT_SUSPENDED);
    await tx.user.update({ where: { id: p.user.id }, data: { status: 'ACTIVE' } });
    await auditRepository.createAuditLog(tx, {
      actorUserId: adminUserId,
      action: 'UPDATE',
      entityType: 'PatientAccount',
      entityId: p.user.id,
      oldValues: { status: 'SUSPENDED' },
      newValues: { status: 'ACTIVE', reason, patientId },
    });
    return { reactivated: true };
  });
}
