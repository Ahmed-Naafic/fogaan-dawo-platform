import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import * as doctorRepository from './doctor.repository.js';
import { suspendDoctor } from './doctor.service.js';
import { ADMIN_DOCTOR_TAB_NAMES } from './doctorAdmin.validation.js';

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

export async function listDoctors({ tab, q, page, pageSize }, client = prisma) {
  const [rows, total, ...tabCounts] = await Promise.all([
    doctorRepository.listDoctorsForAdmin(client, { tab, q, skip: (page - 1) * pageSize, take: pageSize }),
    doctorRepository.countDoctorsForAdmin(client, { tab, q }),
    ...ADMIN_DOCTOR_TAB_NAMES.map((name) => doctorRepository.countDoctorsForAdmin(client, { tab: name })),
  ]);
  return {
    tab,
    counts: Object.fromEntries(ADMIN_DOCTOR_TAB_NAMES.map((name, i) => [name, tabCounts[i]])),
    items: await withSuspensions(client, rows),
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
