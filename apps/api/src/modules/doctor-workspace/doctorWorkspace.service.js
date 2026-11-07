import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { sumMoney, toDecimal } from '../../utils/money.js';
import * as doctorRepository from '../doctors/doctor.repository.js';
import { allocateRefunds, earningsTotals, money } from '../finance/finance.calc.js';
import { describeRange, resolveRange } from '../finance/finance.dates.js';
import { FinanceErrorCode } from '../finance/finance.service.js';
import * as financeRepository from '../finance/finance.repository.js';
import { assignedDoctorPhotoPath, DOCTOR_READ_STATUSES } from '../medical-history/medicalHistory.constants.js';
import { PatientAccessErrorCode } from '../medical-history/medicalHistory.service.js';
import * as repo from './doctorWorkspace.repository.js';

/**
 * The signed-in doctor's own workspace:
 *  - My Patients: only patients with at least one appointment in DOCTOR_READ_STATUSES (paid) with THIS
 *    doctor — the same rule that gates the Patient Information panel and the patient photo. Rows carry
 *    name, the gated photo URL and visit dates only; clinical details stay behind the audited panel.
 *  - My Earnings: the earning snapshots saved when each of the doctor's consultations was paid, after
 *    refunds (same calculation as admin finance). Simulated money; there is no payout system.
 */

/** Statuses of an appointment that is still ahead (counts as the "next visit"). */
const UPCOMING_STATUSES = new Set(['CONFIRMED', 'WAITING', 'IN_PROGRESS']);

/** The doctor acting in the DOCTOR role; reading patients also requires a verified, active account. */
async function doctorOf(auth, { requireActive }) {
  const doctor = await doctorRepository.findDoctorByUserId(prisma, auth.user.id);
  if (!doctor) throw ApiError.forbidden('Doctor profile not found', undefined, PatientAccessErrorCode.denied);
  if (requireActive && (doctor.verificationStatus !== 'VERIFIED' || doctor.accountStatus !== 'ACTIVE')) {
    throw ApiError.forbidden('Your doctor account is not active', undefined, PatientAccessErrorCode.doctorInactive);
  }
  return doctor;
}

/**
 * Groups eligible appointments (newest first) by patient: visits = completed consultations, the last
 * visit (latest one that has started), the next visit (earliest one still ahead) and the authorising
 * appointment (the newest eligible one — what the photo URL and the Patient Information panel use).
 */
export function groupByPatient(appointments, now = new Date()) {
  const byPatient = new Map();
  for (const a of appointments) {
    let row = byPatient.get(a.patientId);
    if (!row) {
      row = { patientId: a.patientId, appointmentId: a.id, appointmentStatus: a.status, appointments: 0, completed: 0, lastVisitAt: null, nextVisitAt: null };
      byPatient.set(a.patientId, row);
    }
    row.appointments += 1;
    if (a.status === 'COMPLETED') row.completed += 1;
    if (a.startAtUtc <= now) {
      if (!row.lastVisitAt || a.startAtUtc > row.lastVisitAt) row.lastVisitAt = a.startAtUtc;
    } else if (UPCOMING_STATUSES.has(a.status) && (!row.nextVisitAt || a.startAtUtc < row.nextVisitAt)) {
      row.nextVisitAt = a.startAtUtc;
    }
  }
  // Patients with a visit coming up first (soonest first), then by most recent visit.
  return [...byPatient.values()].sort((x, y) => {
    if (x.nextVisitAt && y.nextVisitAt) return x.nextVisitAt - y.nextVisitAt;
    if (x.nextVisitAt || y.nextVisitAt) return x.nextVisitAt ? -1 : 1;
    return (y.lastVisitAt ?? 0) - (x.lastVisitAt ?? 0);
  });
}

const presentPatient = (row, profile) => ({
  id: row.patientId,
  name: profile?.user.fullName ?? '',
  photoUrl: assignedDoctorPhotoPath({ patientId: row.patientId, appointmentId: row.appointmentId, status: row.appointmentStatus, avatarUpdatedAt: profile?.user.avatarUpdatedAt }),
  appointmentId: row.appointmentId,
  appointmentStatus: row.appointmentStatus,
  appointments: row.appointments,
  completedConsultations: row.completed,
  lastVisitAt: row.lastVisitAt?.toISOString() ?? null,
  nextVisitAt: row.nextVisitAt?.toISOString() ?? null,
});

/** GET /api/v1/doctors/me/patients?q=&page=&pageSize= */
export async function listMyPatients(auth, { q, page = 1, pageSize = 20 } = {}, now = new Date()) {
  const doctor = await doctorOf(auth, { requireActive: true });
  const rows = groupByPatient(await repo.appointmentsForDoctor(prisma, { doctorId: doctor.id, statuses: DOCTOR_READ_STATUSES, q }), now);
  const slice = rows.slice((page - 1) * pageSize, page * pageSize);
  const profiles = new Map((await repo.patientNames(prisma, slice.map((r) => r.patientId))).map((p) => [p.id, p]));
  return { items: slice.map((r) => presentPatient(r, profiles.get(r.patientId))), total: rows.length, page, pageSize };
}

/**
 * GET /api/v1/doctors/me/patients/:patientId — one patient of this doctor: the same row as the list plus
 * every appointment the two have had (any status; the doctor already sees these in their appointment
 * list). Denied with the same 403 as the Patient Information panel unless an eligible appointment exists.
 */
export async function getMyPatient(auth, { patientId }, now = new Date()) {
  const doctor = await doctorOf(auth, { requireActive: true });
  const appointments = await repo.appointmentsWithPatient(prisma, { doctorId: doctor.id, patientId });
  const eligible = appointments.filter((a) => DOCTOR_READ_STATUSES.includes(a.status)).map((a) => ({ ...a, patientId }));
  if (eligible.length === 0) throw ApiError.forbidden('You can only view patients from your own eligible appointments', undefined, PatientAccessErrorCode.denied);
  const [row] = groupByPatient(eligible, now);
  const [profile] = await repo.patientNames(prisma, [patientId]);
  return {
    patient: presentPatient(row, profile),
    appointments: appointments.map((a) => ({
      id: a.id,
      status: a.status,
      startAtUtc: a.startAtUtc.toISOString(),
      endAtUtc: a.endAtUtc.toISOString(),
      reason: a.reason ?? null,
      bookingType: a.bookingType,
      rescheduled: !!a.originalAppointmentId,
    })),
  };
}

/** GET /api/v1/doctors/me/earnings?preset=&fromDate=&toDate=&tz=&status=&page=&pageSize= */
export async function myEarnings(auth, query = {}) {
  const doctor = await doctorOf(auth, { requireActive: false });
  let range;
  try {
    range = resolveRange(query);
  } catch (error) {
    throw ApiError.badRequest(error.message, [{ path: 'range', message: error.message }], FinanceErrorCode.RANGE_INVALID);
  }
  const [earnings, counts] = await Promise.all([repo.earningsForDoctor(prisma, { doctorId: doctor.id, range, status: query.status }), repo.earningStatusCounts(prisma, { doctorId: doctor.id, range })]);
  const refunds = await financeRepository.allSucceededRefundsForPayments(prisma, [...new Set(earnings.map((e) => e.appointment.payment?.id).filter(Boolean))]);
  const refundsByAppointment = new Map();
  for (const r of refunds) refundsByAppointment.set(r.appointmentId, [...(refundsByAppointment.get(r.appointmentId) ?? []), r.amount]);

  const items = earnings.map((e) => {
    const allocation = allocateRefunds({ gross: e.grossAmount, commission: e.commissionAmount }, refundsByAppointment.get(e.appointmentId) ?? []);
    const doctorDeduction = sumMoney(allocation.map((a) => a.doctor));
    return {
      id: e.id,
      appointmentId: e.appointmentId,
      appointmentStatus: e.appointment.status,
      appointmentStartAt: e.appointment.startAtUtc.toISOString(),
      patientName: e.appointment.patient.user.fullName,
      paidAt: e.createdAt.toISOString(),
      status: e.status,
      gross: money(e.grossAmount),
      commission: money(e.commissionAmount),
      refunds: money(sumMoney(allocation.map((a) => a.amount))),
      refundDeduction: money(doctorDeduction),
      net: money(toDecimal(e.netAmount).minus(doctorDeduction)),
      currency: e.currency,
    };
  });
  const totals = earningsTotals(earnings.map((e) => ({ gross: e.grossAmount, commission: e.commissionAmount, net: e.netAmount, refunds: refundsByAppointment.get(e.appointmentId) ?? [] })));
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  return {
    simulated: true,
    currency: 'USD',
    range: describeRange(range),
    totals,
    statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    items: items.slice((page - 1) * pageSize, page * pageSize),
    total: items.length,
    page,
    pageSize,
    payoutsSupported: false,
  };
}
