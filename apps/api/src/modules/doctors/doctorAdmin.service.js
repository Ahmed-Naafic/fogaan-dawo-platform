import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { isValidTimeZone } from '../../utils/timezone.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';
import * as doctorRepository from './doctor.repository.js';
import { suspendDoctor } from './doctor.service.js';
import { ADMIN_DOCTOR_TAB_NAMES } from './doctorAdmin.validation.js';
import { doctorCancellationsThisMonth, isFlagged } from './doctorCancellations.js';

/**
 * Admin doctor management: the list of registered doctors and the Suspend action.
 * Suspension itself is the single existing rule set in doctor.service.js#suspendDoctor (row lock,
 * appointment cancellation, refund requests, patient notifications, SUSPEND audit entry) — this file
 * only adds the admin-facing guards around it.
 */

function present(d, suspension) {
  return {
    doctorId: d.id,
    userId: d.userId,
    name: d.user.fullName,
    email: d.user.email,
    phone: d.user.phone,
    specialty: d.specialty,
    verificationStatus: d.verificationStatus,
    accountStatus: d.accountStatus,
    consultationFee: d.consultationFee.toFixed(2),
    currency: d.currency,
    licenceNumber: d.licenceNumber,
    licenceCountry: d.licenceCountry,
    yearsExperience: d.yearsExperience,
    country: d.country ?? null,
    timeZone: d.user.timeZone ?? null,
    bio: d.bio ?? '',
    languages: d.languages.map((l) => l.language).sort(),
    verifiedAt: d.verifiedAt?.toISOString() ?? null,
    registeredAt: d.createdAt.toISOString(),
    suspension: suspension
      ? { reason: suspension.newValues?.reason ?? null, at: suspension.createdAt.toISOString(), by: suspension.actor?.fullName ?? null }
      : null,
  };
}

async function withSuspensions(client, doctors) {
  const ids = doctors.filter((d) => d.accountStatus !== 'ACTIVE').map((d) => d.id);
  const latest = new Map();
  for (const log of await doctorRepository.latestSuspensions(client, ids)) if (!latest.has(log.entityId)) latest.set(log.entityId, log);
  return doctors.map((d) => present(d, latest.get(d.id)));
}

/** Adds this month's doctor cancellations and the "more than 3" flag (requirement 11). */
async function withCancellationFlags(client, items) {
  const counts = await doctorCancellationsThisMonth(client, items.map((d) => d.doctorId));
  return items.map((d) => ({ ...d, cancellationsThisMonth: counts.get(d.doctorId) ?? 0, cancellationFlag: isFlagged(counts.get(d.doctorId) ?? 0) }));
}

/**
 * PATCH /api/v1/admin/doctors/:doctorId — requirement 1: the administrator edits a doctor's profile
 * (name, specialty, country, time zone, experience, fee, bio, languages). Fee changes apply to new
 * bookings only. Row-locked, one transaction, audited (UPDATE / DoctorProfile with the changed fields).
 */
export async function updateDoctor({ doctorId, adminUserId, input }) {
  await withTransaction(async (tx) => {
    if (!(await lockRow(tx, 'doctor_profiles', doctorId))) throw ApiError.notFound('Doctor not found');
    const d = await tx.doctorProfile.findUnique({ where: { id: doctorId }, select: { id: true, userId: true, consultationFee: true, verificationStatus: true } });
    if (!d || d.verificationStatus === 'NOT_SUBMITTED') throw ApiError.notFound('Doctor not found');
    if (input.specialtyId && !(await tx.specialty.findFirst({ where: { id: input.specialtyId, isActive: true } }))) {
      throw ApiError.badRequest('Unknown specialty', [{ path: 'specialtyId', message: 'Choose a specialty from the list' }], 'VALIDATION_ERROR');
    }
    if (input.timeZone && !isValidTimeZone(input.timeZone)) throw ApiError.badRequest('Unknown time zone', [{ path: 'timeZone', message: 'Use an IANA time zone such as Europe/London' }], 'VALIDATION_ERROR');
    const data = {};
    for (const k of ['specialtyId', 'country', 'yearsExperience', 'bio']) if (k in input) data[k] = input[k];
    if ('consultationFee' in input) data.consultationFee = input.consultationFee.toFixed(2);
    if (Object.keys(data).length) await tx.doctorProfile.update({ where: { id: doctorId }, data });
    const userData = {};
    if ('fullName' in input) userData.fullName = input.fullName;
    if ('timeZone' in input) userData.timeZone = input.timeZone;
    if (Object.keys(userData).length) await tx.user.update({ where: { id: d.userId }, data: userData });
    if ('languages' in input) await doctorRepository.replaceDoctorLanguages(tx, doctorId, input.languages);
    const feeChanged = 'consultationFee' in input && d.consultationFee.toFixed(2) !== data.consultationFee;
    await auditRepository.createAuditLog(tx, {
      actorUserId: adminUserId,
      action: 'UPDATE',
      entityType: 'DoctorProfile',
      entityId: doctorId,
      oldValues: feeChanged ? { consultationFee: d.consultationFee.toFixed(2) } : undefined,
      newValues: { fields: Object.keys(input).sort(), by: 'ADMIN', ...(feeChanged ? { consultationFee: data.consultationFee, appliesTo: 'new bookings only' } : {}) },
    });
  });
  const updated = await doctorRepository.findDoctorForAdmin(prisma, doctorId);
  return { doctor: (await withCancellationFlags(prisma, await withSuspensions(prisma, [updated])))[0] };
}

/** GET /api/v1/admin/doctors: registered doctors per tab with suspension details and the monthly cancellation flag. */
export async function listDoctors({ tab, q, page, pageSize }, client = prisma) {
  const [rows, total, ...tabCounts] = await Promise.all([
    doctorRepository.listDoctorsForAdmin(client, { tab, q, skip: (page - 1) * pageSize, take: pageSize }),
    doctorRepository.countDoctorsForAdmin(client, { tab, q }),
    ...ADMIN_DOCTOR_TAB_NAMES.map((name) => doctorRepository.countDoctorsForAdmin(client, { tab: name })),
  ]);
  return {
    tab,
    counts: Object.fromEntries(ADMIN_DOCTOR_TAB_NAMES.map((name, i) => [name, tabCounts[i]])),
    items: await withCancellationFlags(client, await withSuspensions(client, rows)),
    total,
    page,
    pageSize,
  };
}

/** Suspends a doctor via the existing service. Admins cannot suspend their own doctor profile. */
export async function suspend({ doctorId, adminUserId, reason }, client = prisma) {
  const doctor = await doctorRepository.findDoctorForAdmin(client, doctorId);
  if (!doctor || doctor.verificationStatus === 'NOT_SUBMITTED') throw ApiError.notFound('Doctor not found');
  if (doctor.userId === adminUserId) throw ApiError.forbidden('You cannot suspend your own doctor profile', undefined, 'SELF_ACTION_FORBIDDEN');
  const result = await suspendDoctor({ doctorId, adminUserId, reason });
  const [updated] = await withSuspensions(client, [await doctorRepository.findDoctorForAdmin(client, doctorId)]);
  return { doctor: updated, cancelledAppointments: result.cancelledAppointmentIds.length, refundRequests: result.refunds.length };
}
