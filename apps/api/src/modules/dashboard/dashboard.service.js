import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { addDays, dateInZone, isValidTimeZone, startOfDayUtc } from '../../utils/timezone.js';
import * as appointmentRepository from '../appointments/appointment.repository.js';
import * as booking from '../appointments/appointmentBooking.service.js';
import { myEarnings } from '../doctor-workspace/doctorWorkspace.service.js';
import { BOOKABLE_DOCTOR_WHERE } from '../doctors/doctor.constants.js';

/**
 * Dashboard summaries. Every figure is read from the database for the signed-in person (or, for the
 * public landing page, from listed doctors only) — no sample data. Lists and details reuse the existing
 * appointment services, so ownership rules, display statuses and join/reschedule actions stay identical.
 */

/** Paid, not-yet-finished visits: what a patient or doctor thinks of as "upcoming". */
const BOOKED = ['CONFIRMED', 'WAITING', 'IN_PROGRESS'];
/** Paid visits that belong on a doctor's day (including ones already finished today). */
const ON_THE_DAY = ['CONFIRMED', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW'];
const SCHEDULE_DAYS = 7;

const doctorPhotoUrl = (doctorId, avatarUpdatedAt) => (avatarUpdatedAt ? `/v1/doctors/${doctorId}/photo?v=${new Date(avatarUpdatedAt).getTime()}` : null);

/** GET /api/v1/appointments/summary — the patient's own counts and next booked visit. */
export async function patientSummary(auth, now = new Date()) {
  const patient = await appointmentRepository.findPatientByUserId(prisma, auth.user.id);
  if (!patient) throw ApiError.forbidden('A patient profile is required', undefined, 'NOT_A_PATIENT');
  const patientId = patient.id;
  const [upcoming, completed, prescriptions, documents, next] = await Promise.all([
    prisma.appointment.count({ where: { patientId, status: { in: BOOKED }, endAtUtc: { gt: now } } }),
    prisma.appointment.count({ where: { patientId, status: 'COMPLETED' } }),
    // Record counts degrade to null (shown as "—") rather than hiding the whole dashboard if they fail.
    prisma.prescription.count({ where: { patientId, status: { not: 'DRAFT' } } }).catch(() => null),
    prisma.consultationAttachment.count({ where: { consultation: { patientId }, archivedAt: null } }).catch(() => null),
    prisma.appointment.findFirst({
      where: { patientId, status: { in: BOOKED }, endAtUtc: { gt: now } },
      orderBy: { startAtUtc: 'asc' },
      select: { id: true, doctor: { select: { id: true, user: { select: { avatarUpdatedAt: true } } } } },
    }),
  ]);
  let nextAppointment = null;
  if (next) {
    const detail = await booking.getMine(auth, next.id, now);
    nextAppointment = {
      id: detail.id,
      status: detail.status,
      startAtUtc: detail.startAtUtc,
      endAtUtc: detail.endAtUtc,
      durationMinutes: Math.round((Date.parse(detail.endAtUtc) - Date.parse(detail.startAtUtc)) / 60_000),
      doctor: { id: detail.doctor.id, name: detail.doctor.name, specialty: detail.doctor.specialty, photoUrl: doctorPhotoUrl(next.doctor.id, next.doctor.user.avatarUpdatedAt) },
      canJoin: Boolean(detail.actions.join?.allowed),
      canReschedule: Boolean(detail.actions.reschedule?.allowed),
    };
  }
  return { counts: { upcoming, completed, prescriptions, documents }, nextAppointment, serverTime: now.toISOString() };
}

/**
 * GET /api/v1/doctors/me/appointments/summary?tz= — the doctor's day in their time zone: today's paid
 * visits, who is waiting now, completed visits and calculated earnings in the last 30 days, and the paid
 * schedule for the next 7 days. `tz` defaults to the doctor's own zone.
 */
export async function doctorSummary(auth, { tz } = {}, now = new Date()) {
  const doctor = await prisma.doctorProfile.findUnique({ where: { userId: auth.user.id }, select: { id: true, user: { select: { timeZone: true } } } });
  if (!doctor) throw ApiError.forbidden('Doctor profile not found');
  const zone = [tz, doctor.user.timeZone].find((z) => z && isValidTimeZone(z)) ?? 'Africa/Mogadishu';
  const today = dateInZone(now, zone);
  const dayStart = startOfDayUtc(today, zone);
  const dayEnd = startOfDayUtc(addDays(today, 1), zone);
  const scheduleEnd = startOfDayUtc(addDays(today, SCHEDULE_DAYS), zone);
  const last30Start = startOfDayUtc(addDays(today, -29), zone);
  const doctorId = doctor.id;

  const [todayCount, waiting, completed30d, earnings, upcoming] = await Promise.all([
    prisma.appointment.count({ where: { doctorId, status: { in: ON_THE_DAY }, startAtUtc: { gte: dayStart, lt: dayEnd } } }),
    prisma.appointment.count({ where: { doctorId, status: 'WAITING', endAtUtc: { gt: now } } }),
    prisma.appointment.count({ where: { doctorId, status: 'COMPLETED', startAtUtc: { gte: last30Start, lt: dayEnd } } }),
    myEarnings(auth, { preset: '30d', tz: zone, pageSize: 1 }).catch(() => null),
    booking.listForDoctor(auth, { scope: 'upcoming' }, now),
  ]);
  const schedule = upcoming.filter((a) => BOOKED.includes(a.status) && Date.parse(a.startAtUtc) < scheduleEnd.getTime());
  return {
    timeZone: zone,
    today,
    days: Array.from({ length: SCHEDULE_DAYS }, (_, i) => addDays(today, i)),
    stats: {
      today: todayCount,
      waiting,
      completed30d,
      earnings30d: earnings ? { amount: earnings.totals.doctorNet, currency: earnings.currency, simulated: earnings.simulated } : null,
    },
    schedule: schedule.map((a) => ({ ...a, day: dateInZone(new Date(a.startAtUtc), zone) })),
    serverTime: now.toISOString(),
  };
}

/**
 * GET /api/v1/public/stats — figures for the landing page, from listed (verified, active) doctors only.
 * Counts only, no personal data. `rating` is null until at least one review exists.
 */
export async function publicStats(client = prisma) {
  const [doctors, bySpecialty, specialties, consultations, rating] = await Promise.all([
    client.doctorProfile.count({ where: BOOKABLE_DOCTOR_WHERE }),
    client.doctorProfile.groupBy({ by: ['specialtyId'], where: BOOKABLE_DOCTOR_WHERE, _count: { _all: true } }),
    client.specialty.findMany({ where: { isActive: true }, select: { id: true, nameEn: true, nameSo: true }, orderBy: { nameEn: 'asc' } }),
    client.appointment.count({ where: { status: 'COMPLETED' } }),
    client.review.aggregate({ _avg: { rating: true }, _count: { _all: true } }),
  ]);
  const counts = new Map(bySpecialty.map((r) => [r.specialtyId, r._count._all]));
  return {
    doctors,
    completedConsultations: consultations,
    rating: rating._count._all ? { average: Math.round(rating._avg.rating * 10) / 10, count: rating._count._all } : null,
    specialties: specialties.map((s) => ({ ...s, doctors: counts.get(s.id) ?? 0 })),
  };
}
