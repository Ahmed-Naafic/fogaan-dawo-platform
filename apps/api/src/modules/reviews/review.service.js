import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';
import { BOOKABLE_DOCTOR_WHERE } from '../doctors/doctor.constants.js';

/**
 * Ratings (requirement 13): after a COMPLETED consultation the patient gives 1–5 stars and an optional
 * comment. Only completed consultations can be rated, once each (unique appointment_id). Public lists
 * show the first name and last initial only, never contact or clinical data.
 */

export const ReviewErrorCode = Object.freeze({
  NOT_COMPLETED: 'REVIEW_NOT_ALLOWED',
  ALREADY_RATED: 'REVIEW_ALREADY_SUBMITTED',
});

const shortName = (fullName = '') => {
  const [first, ...rest] = fullName.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0].toUpperCase()}.` : first;
};

export const presentReview = (r) => ({ id: r.id, rating: r.rating, comment: r.comment ?? null, createdAt: r.createdAt.toISOString() });

/** Whether the appointment can be rated now: { allowed, blocker }. */
export function ratingAction(appointment, existing) {
  if (existing) return { allowed: false, blocker: 'ALREADY_RATED' };
  if (appointment.status !== 'COMPLETED') return { allowed: false, blocker: 'NOT_COMPLETED' };
  return { allowed: true, blocker: null };
}

/**
 * POST /api/v1/appointments/:id/review — { rating: 1..5, comment? } by the appointment's patient.
 * 404 for another person's appointment; 409 REVIEW_NOT_ALLOWED unless COMPLETED; 409
 * REVIEW_ALREADY_SUBMITTED on a second rating. Audited (CREATE / Review).
 */
export async function rateAppointment(auth, appointmentId, { rating, comment }) {
  const patient = await prisma.patientProfile.findUnique({ where: { userId: auth.user.id }, select: { id: true } });
  if (!patient) throw ApiError.forbidden('A patient profile is required', undefined, 'NOT_A_PATIENT');
  return withTransaction(async (tx) => {
    if (!(await lockRow(tx, 'appointments', appointmentId))) throw ApiError.notFound('Appointment not found');
    const a = await tx.appointment.findUnique({ where: { id: appointmentId }, select: { id: true, patientId: true, doctorId: true, status: true } });
    if (!a || a.patientId !== patient.id) throw ApiError.notFound('Appointment not found');
    const existing = await tx.review.findUnique({ where: { appointmentId } });
    const action = ratingAction(a, existing);
    if (action.blocker === 'ALREADY_RATED') throw ApiError.conflict('You have already rated this consultation', undefined, ReviewErrorCode.ALREADY_RATED);
    if (action.blocker) throw ApiError.conflict('Only a completed consultation can be rated', { status: a.status }, ReviewErrorCode.NOT_COMPLETED);
    const review = await tx.review.create({ data: { appointmentId, patientId: patient.id, doctorId: a.doctorId, rating, comment: comment || null } });
    await auditRepository.createAuditLog(tx, { actorUserId: auth.user.id, action: 'CREATE', entityType: 'Review', entityId: review.id, newValues: { appointmentId, doctorId: a.doctorId, rating } });
    return presentReview(review);
  });
}

/** GET /api/v1/doctors/:doctorId/reviews?page= — public, listed doctors only: summary + newest comments. */
export async function listDoctorReviews(doctorId, { page = 1, pageSize = 10 } = {}) {
  const doctor = await prisma.doctorProfile.findFirst({ where: { id: doctorId, ...BOOKABLE_DOCTOR_WHERE }, select: { id: true } });
  if (!doctor) throw ApiError.notFound('Doctor not found');
  const [rows, total, agg, byStars] = await Promise.all([
    prisma.review.findMany({ where: { doctorId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { patient: { select: { user: { select: { fullName: true } } } } } }),
    prisma.review.count({ where: { doctorId } }),
    prisma.review.aggregate({ where: { doctorId }, _avg: { rating: true } }),
    prisma.review.groupBy({ by: ['rating'], where: { doctorId }, _count: { _all: true } }),
  ]);
  return {
    average: total ? Math.round(agg._avg.rating * 10) / 10 : null,
    count: total,
    distribution: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, byStars.find((b) => b.rating === n)?._count._all ?? 0])),
    items: rows.map((r) => ({ ...presentReview(r), author: shortName(r.patient.user.fullName) })),
    page,
    pageSize,
  };
}
