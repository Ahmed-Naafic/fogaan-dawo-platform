import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { lockRow, rethrowConflict, withTransaction } from '../../utils/transaction.js';
import * as doctorRepository from '../doctors/doctor.repository.js';
import * as notificationEvents from '../notifications/notification.events.js';
import { cancelRemindersForAppointment } from '../notifications/reminder.service.js';
import { joinAction } from '../consultations/consultation.policy.js';
import { createRefundRequest, findPaymentForAppointment } from '../refunds/refund.service.js';
import * as appointmentRepository from './appointment.repository.js';
import { NO_ADMIT_REFUND_MINUTES, cancellationPreview, noShowRefundBlocker, refundAmount, refundRate, rescheduleBlocker } from './appointment.policy.js';
import * as auditRepository from '../audit/audit.repository.js';
import { presentReview, ratingAction } from '../reviews/review.service.js';
import { checkDoctorCancellationFlag } from '../doctors/doctorCancellations.js';
import { isFreeAppointment } from './followUp.service.js';

async function followUpOrigin(client, consultationId) {
  const c = await client.consultation.findUnique({ where: { id: consultationId }, select: { id: true, appointment: { select: { id: true, startAtUtc: true } } } });
  return c ? { consultationId: c.id, appointmentId: c.appointment.id, startAtUtc: c.appointment.startAtUtc.toISOString() } : null;
}
import { cancelLockedAppointment, reserveSlot } from './appointment.service.js';
import { assignedDoctorPhotoPath } from '../medical-history/medicalHistory.constants.js';
import { getBookingPolicy } from '../settings/bookingPolicy.js';

/**
 * Patient and doctor booking operations over HTTP. Every rule lives in an existing service or in
 * appointment.policy.js; this file adds ownership checks, presentation and notifications.
 * The patient or doctor is always the signed-in user — no profile id is accepted from the client.
 */

export const BookingErrorCode = Object.freeze({
  NOT_A_PATIENT: 'PATIENT_PROFILE_REQUIRED',
  SELF_BOOKING: 'SELF_BOOKING_FORBIDDEN',
  NOT_CANCELLABLE: 'APPOINTMENT_NOT_CANCELLABLE',
  RESCHEDULE_NOT_ALLOWED: 'RESCHEDULE_NOT_ALLOWED',
  SLOT_UNAVAILABLE: 'SLOT_UNAVAILABLE',
});

/* ------------------------------------------------------------ identity */

async function patientOf(client, auth) {
  const patient = await appointmentRepository.findPatientByUserId(client, auth.user.id);
  if (!patient) throw ApiError.forbidden('A patient profile is required to book', undefined, BookingErrorCode.NOT_A_PATIENT);
  return patient;
}
async function doctorOf(client, auth) {
  const doctor = await appointmentRepository.findDoctorByUserId(client, auth.user.id);
  if (!doctor) throw ApiError.forbidden('Doctor profile not found');
  return doctor;
}

/* ------------------------------------------------------------ presentation */

/** Display status: an unpaid hold past its deadline is shown as EXPIRED even before the sweep runs. */
const displayStatus = (a, now) => (a.status === 'PENDING_PAYMENT' && a.holdExpiresAt && a.holdExpiresAt <= now ? 'EXPIRED' : a.status);

/**
 * The patient as the assigned doctor sees them on an appointment: record id (for the Patient Information
 * panel), name, and the gated, audited photo URL when the appointment status allows it.
 */
const doctorViewPatient = (a) => ({
  id: a.patientId,
  name: a.patient.user.fullName,
  photoUrl: assignedDoctorPhotoPath({ patientId: a.patientId, appointmentId: a.id, status: a.status, avatarUpdatedAt: a.patient.user.avatarUpdatedAt }),
});

function presentListItem(a, viewer, now) {
  return {
    id: a.id,
    status: displayStatus(a, now),
    bookingType: a.bookingType,
    startAtUtc: a.startAtUtc.toISOString(),
    endAtUtc: a.endAtUtc.toISOString(),
    holdExpiresAt: a.status === 'PENDING_PAYMENT' ? a.holdExpiresAt?.toISOString() ?? null : null,
    fee: a.feeAmount.toFixed(2),
    currency: a.currency,
    rescheduled: !!a.originalAppointmentId,
    ...(viewer === 'PATIENT'
      ? { doctor: { id: a.doctor.id, name: a.doctor.user.fullName, specialty: a.doctor.specialty } }
      : { patient: doctorViewPatient(a), reason: a.reason ?? null }),
  };
}

async function presentDetail(client, a, viewer, now) {
  const paid = await findPaymentForAppointment(client, a.id);
  const isPaid = paid?.payment.status === 'SUCCEEDED';
  const refunds = await appointmentRepository.findRefundsForAppointments(client, [...new Set([a.id, paid?.appointmentId].filter(Boolean))]);
  const status = displayStatus(a, now);
  const live = { ...a, status };
  const policy = await getBookingPolicy(client);
  const review = viewer === 'PATIENT' ? await client.review.findUnique({ where: { appointmentId: a.id } }) : null;
  return {
    ...presentListItem(a, viewer, now),
    reason: a.reason ?? null,
    cancellationReason: a.cancellationReason ?? null,
    cancelledAt: a.cancelledAt?.toISOString() ?? null,
    doctor: { id: a.doctor.id, name: a.doctor.user.fullName, specialty: a.doctor.specialty, timeZone: a.doctor.user.timeZone },
    // The patient's record id lets the assigned doctor open the read-only Patient Information panel.
    ...(viewer === 'DOCTOR' ? { patient: doctorViewPatient(a) } : {}),
    payment: paid ? { status: paid.payment.status, amount: paid.payment.amount.toFixed(2), currency: paid.payment.currency, paidAt: paid.payment.paidAt?.toISOString() ?? null } : null,
    refunds: refunds.map((r) => ({ id: r.id, amount: r.amount.toFixed(2), currency: r.currency, status: r.status, createdAt: r.createdAt.toISOString() })),
    history: a.statusHistory.map((h) => ({ from: h.fromStatus, to: h.toStatus, reason: h.reason, at: h.createdAt.toISOString() })),
    rescheduledFrom: a.originalAppointment ? { id: a.originalAppointment.id, startAtUtc: a.originalAppointment.startAtUtc.toISOString() } : null,
    rescheduledTo: a.rescheduledAppointments[0] ? { id: a.rescheduledAppointments[0].id, startAtUtc: a.rescheduledAppointments[0].startAtUtc.toISOString() } : null,
    serverTime: now.toISOString(),
    actions: {
      cancel: cancellationPreview(live, { paid: isPaid, now, cancelledBy: viewer, policy }),
      reschedule: viewer === 'PATIENT' ? { allowed: rescheduleBlocker(live, now, policy) === null, blocker: rescheduleBlocker(live, now, policy) } : { allowed: false, blocker: 'PATIENT_ONLY' },
      join: joinAction(a, { paymentStatus: paid?.payment.status ?? (isFreeAppointment(a) && a.status !== 'PENDING_PAYMENT' ? 'SUCCEEDED' : null), refunded: refunds.some((r) => r.status !== 'FAILED'), consultation: a.consultation, now }),
      rate: viewer === 'PATIENT' ? ratingAction(a, review) : { allowed: false, blocker: 'PATIENT_ONLY' },
      noShowRefund: viewer === 'PATIENT' ? noShowRefundAction(a, { paid: isPaid, refunded: refunds.some((r) => r.status !== 'FAILED'), now }) : { allowed: false, blocker: 'PATIENT_ONLY', availableAt: null },
    },
    consultation: a.consultation ? { id: a.consultation.id, status: a.consultation.status } : null,
    review: review ? presentReview(review) : null,
    // Follow-ups link to the original consultation in the patient's history (requirement 12).
    followUpOf: a.followUpOfConsultationId ? await followUpOrigin(client, a.followUpOfConsultationId) : null,
    freeFollowUp: isFreeAppointment(a),
    // The thresholds in force now, so the cancellation/reschedule wording matches what the server applies.
    policy: { fullRefundMinHours: policy.fullRefundMinHours, partialRefundMinHours: policy.partialRefundMinHours, freeRescheduleMinHours: policy.freeRescheduleMinHours, maxFreeReschedules: policy.maxFreeReschedules },
  };
}

async function loadOwned(client, id, { patientId, doctorId }) {
  const a = await appointmentRepository.findAppointmentDetail(client, id);
  // Another person's appointment is indistinguishable from a missing one.
  if (!a || (patientId && a.patientId !== patientId) || (doctorId && a.doctorId !== doctorId)) throw ApiError.notFound('Appointment not found');
  return a;
}

/* ------------------------------------------------------------ patient */

/** Creates the temporary reservation (10-minute hold) through the existing reserveSlot rules. */
export async function bookSlot(auth, { slotId, reason }, now = new Date()) {
  const patient = await patientOf(prisma, auth);
  const slot = await appointmentRepository.findSlotById(prisma, slotId);
  if (!slot) throw ApiError.notFound('Slot not found');
  const doctor = await doctorRepository.findDoctorById(prisma, slot.doctorId);
  if (doctor?.userId === auth.user.id) throw ApiError.forbidden('You cannot book a consultation with yourself', undefined, BookingErrorCode.SELF_BOOKING);
  let appointment;
  try {
    appointment = await reserveSlot({ patientId: patient.id, slotId, reason: reason || null, now });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) throw new ApiError(409, error.message, undefined, BookingErrorCode.SLOT_UNAVAILABLE);
    throw error;
  }
  await notificationEvents.appointmentReserved(prisma, appointment.id);
  return presentDetail(prisma, await appointmentRepository.findAppointmentDetail(prisma, appointment.id), 'PATIENT', now);
}

export async function listMine(auth, { scope }, now = new Date()) {
  const patient = await patientOf(prisma, auth);
  return (await appointmentRepository.listAppointments(prisma, { patientId: patient.id, scope, now })).map((a) => presentListItem(a, 'PATIENT', now));
}

export async function getMine(auth, id, now = new Date()) {
  const patient = await patientOf(prisma, auth);
  return presentDetail(prisma, await loadOwned(prisma, id, { patientId: patient.id }), 'PATIENT', now);
}

/** Shared cancellation: refund per the approved policy (if paid), slot released or withdrawn, other party notified. */
async function cancelOwned({ id, ownerWhere, viewer, reason, actorUserId, now }) {
  const result = await withTransaction(async (tx) => {
    if (!(await lockRow(tx, 'appointments', id))) throw ApiError.notFound('Appointment not found');
    const a = await loadOwned(tx, id, ownerWhere);
    if (displayStatus(a, now) === 'EXPIRED') throw ApiError.conflict('This reservation has already expired', undefined, BookingErrorCode.NOT_CANCELLABLE);
    const paid = (await findPaymentForAppointment(tx, a.id))?.payment.status === 'SUCCEEDED';
    const rate = paid ? refundRate({ startAtUtc: a.startAtUtc, now, cancelledBy: viewer, policy: await getBookingPolicy(tx) }) : 0;
    const label = viewer === 'DOCTOR' ? 'Cancelled by the doctor' : 'Cancelled by the patient';
    await cancelLockedAppointment(tx, a, { reason: reason ? `${label}: ${reason}` : label, changedBy: actorUserId, now, slotStatus: viewer === 'DOCTOR' ? 'CANCELLED' : 'AVAILABLE' });
    let refund = null;
    if (paid && rate > 0) {
      refund = await createRefundRequest(tx, { appointmentId: a.id, reason: `${label} — ${Math.round(rate * 100)}% refund`, amount: refundAmount(a.feeAmount, rate) });
    }
    if (refund) await notificationEvents.refundRequested(tx, refund);
    await notificationEvents.appointmentCancelled(tx, { appointmentId: a.id, by: viewer, wasConfirmed: a.status === 'CONFIRMED', refund: Boolean(refund) });
    if (viewer === 'DOCTOR') await checkDoctorCancellationFlag(tx, { doctorId: a.doctorId, actorUserId, now });
    return { rate, refund };
  });
  return result;
}

const noShowRefundAction = (a, { paid, refunded, now }) => {
  const blocker = noShowRefundBlocker(a, { paid, refunded, consultation: a.consultation, now });
  return { allowed: blocker === null, blocker, availableAt: new Date(a.startAtUtc.getTime() + NO_ADMIT_REFUND_MINUTES * 60_000).toISOString() };
};

/**
 * POST /api/v1/appointments/:id/no-show-refund — requirement 6: the doctor did not admit the patient
 * within 15 minutes of the start. Cancels the appointment (and an un-admitted consultation), withdraws
 * the slot, creates a FULL refund request, notifies the doctor and audits. One transaction, rows locked.
 */
export async function requestNoShowRefund(auth, id, now = new Date()) {
  const patient = await patientOf(prisma, auth);
  const refund = await withTransaction(async (tx) => {
    if (!(await lockRow(tx, 'appointments', id))) throw ApiError.notFound('Appointment not found');
    const a = await loadOwned(tx, id, { patientId: patient.id });
    const paid = await findPaymentForAppointment(tx, a.id);
    const refunds = await appointmentRepository.findRefundsForAppointments(tx, [...new Set([a.id, paid?.appointmentId].filter(Boolean))]);
    const blocker = noShowRefundBlocker(a, { paid: paid?.payment.status === 'SUCCEEDED', refunded: refunds.some((r) => r.status !== 'FAILED'), consultation: a.consultation, now });
    if (blocker) throw ApiError.conflict('A no-show refund is not available for this appointment', { blocker, availableAt: new Date(a.startAtUtc.getTime() + NO_ADMIT_REFUND_MINUTES * 60_000).toISOString() }, 'NO_SHOW_REFUND_NOT_ALLOWED');
    const reason = `Doctor did not admit the patient within ${NO_ADMIT_REFUND_MINUTES} minutes`;
    await appointmentRepository.updateAppointment(tx, a.id, { status: 'CANCELLED', cancelledAt: now, cancellationReason: reason, holdExpiresAt: null });
    await appointmentRepository.recordStatusChange(tx, { appointmentId: a.id, fromStatus: a.status, toStatus: 'CANCELLED', reason, changedBy: auth.user.id });
    await cancelRemindersForAppointment(tx, a.id);
    await lockRow(tx, 'availability_slots', a.slotId);
    await appointmentRepository.setSlotStatus(tx, a.slotId, 'CANCELLED');
    if (a.consultation && a.consultation.status === 'WAITING') {
      await tx.consultation.update({ where: { id: a.consultation.id }, data: { status: 'CANCELLED', endedAt: now } });
    }
    const created = await createRefundRequest(tx, { appointmentId: a.id, reason: `${reason} — full refund` });
    await notificationEvents.refundRequested(tx, created);
    await notificationEvents.appointmentCancelled(tx, { appointmentId: a.id, by: 'PATIENT', wasConfirmed: true, refund: true });
    await auditRepository.createAuditLog(tx, { actorUserId: auth.user.id, action: 'REFUND', entityType: 'Appointment', entityId: a.id, newValues: { status: 'CANCELLED', reason: 'DOCTOR_DID_NOT_ADMIT', refundId: created.id, amount: created.amount.toFixed(2) } });
    return created;
  });
  return { appointment: await getMine(auth, id, now), refund: { amount: refund.amount.toFixed(2), status: refund.status } };
}

/**
 * POST /api/v1/appointments/:id/consultation-record — requirement 5 ("optionally attach files"): makes sure
 * the appointment has its consultation record so the patient can attach lab results while booking. Allowed
 * for the patient's own reservation (still within its hold) or a paid appointment. Returns { consultationId }.
 * The doctor can see these files only once the booking is paid.
 */
export async function ensureConsultationRecord(auth, id, now = new Date()) {
  const patient = await patientOf(prisma, auth);
  return withTransaction(async (tx) => {
    if (!(await lockRow(tx, 'appointments', id))) throw ApiError.notFound('Appointment not found');
    const a = await loadOwned(tx, id, { patientId: patient.id });
    if (a.consultation) return { consultationId: a.consultation.id };
    const open = displayStatus(a, now) === 'PENDING_PAYMENT' || ['CONFIRMED', 'WAITING', 'IN_PROGRESS'].includes(a.status);
    if (!open) throw ApiError.conflict('Files can be attached only to an active booking', { status: displayStatus(a, now) }, 'ATTACHMENTS_NOT_ALLOWED');
    const c = await tx.consultation.create({ data: { appointmentId: a.id, patientId: a.patientId, doctorId: a.doctorId } });
    return { consultationId: c.id };
  });
}

export async function cancelMine(auth, id, { reason }, now = new Date()) {
  const patient = await patientOf(prisma, auth);
  const { rate, refund } = await cancelOwned({ id, ownerWhere: { patientId: patient.id }, viewer: 'PATIENT', reason, actorUserId: auth.user.id, now });
  return { appointment: await getMine(auth, id, now), refundRate: rate, refund: refund ? { amount: refund.amount.toFixed(2), status: refund.status } : null };
}

/**
 * The one free reschedule (approved rule): only a CONFIRMED appointment, more than 24 h before it,
 * never rescheduled before; the new slot must be an open future slot of the same doctor. Creates a
 * linked new CONFIRMED appointment (paid by the original's payment) and marks the original RESCHEDULED.
 */
export async function rescheduleMine(auth, id, { slotId }, now = new Date()) {
  const patient = await patientOf(prisma, auth);
  let newId;
  try {
    newId = await withTransaction(async (tx) => {
      if (!(await lockRow(tx, 'appointments', id))) throw ApiError.notFound('Appointment not found');
      const original = await loadOwned(tx, id, { patientId: patient.id });
      const blocker = rescheduleBlocker(original, now, await getBookingPolicy(tx));
      if (blocker) throw ApiError.conflict('This appointment cannot be rescheduled for free', { blocker }, BookingErrorCode.RESCHEDULE_NOT_ALLOWED);
      if (slotId === original.slotId) throw ApiError.badRequest('Choose a different time', [{ path: 'slotId', message: 'Same slot' }], 'VALIDATION_ERROR');

      if (!(await lockRow(tx, 'availability_slots', slotId))) throw ApiError.notFound('Slot not found');
      const slot = await appointmentRepository.findSlotById(tx, slotId);
      if (slot.doctorId !== original.doctorId) throw ApiError.badRequest('Rescheduling keeps the same doctor', [{ path: 'slotId', message: 'Different doctor' }], 'VALIDATION_ERROR');
      if (slot.status !== 'AVAILABLE' || slot.startAtUtc <= now) throw ApiError.conflict('That time is no longer available', undefined, BookingErrorCode.SLOT_UNAVAILABLE);
      if (!(await doctorRepository.findBookableDoctor(tx, slot.doctorId))) throw ApiError.conflict('Doctor is not verified or not active', undefined, BookingErrorCode.SLOT_UNAVAILABLE);

      const created = await appointmentRepository.createAppointment(tx, {
        patientId: original.patientId,
        doctorId: original.doctorId,
        slotId,
        status: 'CONFIRMED',
        bookingType: original.bookingType,
        reason: original.reason,
        feeAmount: original.feeAmount,
        currency: original.currency,
        commissionRateSnapshot: original.commissionRateSnapshot,
        startAtUtc: slot.startAtUtc,
        endAtUtc: slot.endAtUtc,
        originalAppointmentId: original.id,
        followUpOfConsultationId: original.followUpOfConsultationId,
        rescheduleCount: original.rescheduleCount + 1,
      });
      await appointmentRepository.recordStatusChange(tx, { appointmentId: created.id, fromStatus: null, toStatus: 'CONFIRMED', reason: 'Rescheduled from an earlier appointment (already paid)', changedBy: auth.user.id });
      await appointmentRepository.setSlotStatus(tx, slotId, 'BOOKED');

      await appointmentRepository.updateAppointment(tx, original.id, { status: 'RESCHEDULED' });
      await appointmentRepository.recordStatusChange(tx, { appointmentId: original.id, fromStatus: 'CONFIRMED', toStatus: 'RESCHEDULED', reason: 'Free reschedule by the patient', changedBy: auth.user.id });
      await lockRow(tx, 'availability_slots', original.slotId);
      await appointmentRepository.setSlotStatus(tx, original.slotId, 'AVAILABLE');
      await cancelRemindersForAppointment(tx, original.id);
      await notificationEvents.appointmentRescheduled(tx, { fromAppointmentId: original.id, toAppointmentId: created.id });
      return created.id;
    });
  } catch (error) {
    rethrowConflict(error, 'That time is no longer available');
  }
  return getMine(auth, newId, now);
}

/* ------------------------------------------------------------ doctor */

export async function listForDoctor(auth, { scope }, now = new Date()) {
  const doctor = await doctorOf(prisma, auth);
  return (await appointmentRepository.listAppointments(prisma, { doctorId: doctor.id, scope, now })).map((a) => presentListItem(a, 'DOCTOR', now));
}

export async function getForDoctor(auth, id, now = new Date()) {
  const doctor = await doctorOf(prisma, auth);
  return presentDetail(prisma, await loadOwned(prisma, id, { doctorId: doctor.id }), 'DOCTOR', now);
}

/** Doctor cancellation: always a full refund of what was paid; the slot is withdrawn (not re-offered). */
export async function cancelForDoctor(auth, id, { reason }, now = new Date()) {
  const doctor = await doctorOf(prisma, auth);
  const { refund } = await cancelOwned({ id, ownerWhere: { doctorId: doctor.id }, viewer: 'DOCTOR', reason, actorUserId: auth.user.id, now });
  return { appointment: await getForDoctor(auth, id, now), refundRate: 1, refund: refund ? { amount: refund.amount.toFixed(2), status: refund.status } : null };
}
