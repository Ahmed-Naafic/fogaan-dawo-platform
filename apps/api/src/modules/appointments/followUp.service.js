import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { roundMoney, toDecimal } from '../../utils/money.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';
import * as notificationEvents from '../notifications/notification.events.js';
import * as appointmentRepository from './appointment.repository.js';
import { reserveSlot } from './appointment.service.js';

/**
 * Follow-ups (requirement 12). At the end of a consultation the doctor books a follow-up in one of their
 * own free slots and chooses the fee: NORMAL (their current fee), DISCOUNTED (50 %) or FREE. The patient
 * must confirm and pay (or, when free, just confirm) before the follow-up deadline (48 hours by default,
 * Admin › Settings, never later than the slot itself), or the hold sweep releases the slot.
 * The follow-up links to the original consultation (appointments.follow_up_of_consultation_id).
 */

export const FOLLOW_UP_FEES = Object.freeze(['NORMAL', 'DISCOUNTED', 'FREE']);
export const FOLLOW_UP_DISCOUNT_RATE = 0.5;
const ACTIVE = ['PENDING_PAYMENT', 'CONFIRMED', 'WAITING', 'IN_PROGRESS'];

export const FollowUpErrorCode = Object.freeze({
  NOT_ALLOWED: 'FOLLOW_UP_NOT_ALLOWED',
  EXISTS: 'FOLLOW_UP_EXISTS',
  SLOT: 'FOLLOW_UP_SLOT_INVALID',
  NOT_FREE: 'FOLLOW_UP_NOT_FREE',
});

/** The follow-up fee for a choice, from the doctor's current fee. */
export function followUpFee(choice, doctorFee) {
  if (choice === 'FREE') return toDecimal(0);
  if (choice === 'DISCOUNTED') return roundMoney(toDecimal(doctorFee).times(FOLLOW_UP_DISCOUNT_RATE));
  return roundMoney(doctorFee);
}

/** A $0 follow-up is covered without a payment (used by join and payment eligibility). */
export const isFreeAppointment = (a) => a?.bookingType === 'FOLLOW_UP' && toDecimal(a.feeAmount).isZero();

/**
 * POST /api/v1/consultations/:consultationId/follow-up (DOCTOR of a COMPLETED consultation).
 * Body { slotId, fee: NORMAL|DISCOUNTED|FREE }. The slot must be the doctor's own open future slot.
 * One active follow-up per consultation (409 FOLLOW_UP_EXISTS). Creates a PENDING_PAYMENT FOLLOW_UP
 * appointment for the same patient with the follow-up deadline, notifies the patient, audits.
 */
export async function proposeFollowUp(auth, consultationId, { slotId, fee }, now = new Date()) {
  const doctor = await prisma.doctorProfile.findUnique({ where: { userId: auth.user.id }, select: { id: true, consultationFee: true } });
  if (!doctor) throw ApiError.forbidden('Doctors only');
  const consultation = await prisma.consultation.findUnique({ where: { id: consultationId }, select: { id: true, doctorId: true, patientId: true, status: true } });
  if (!consultation || consultation.doctorId !== doctor.id) throw ApiError.notFound('Consultation not found');
  if (consultation.status !== 'COMPLETED') throw ApiError.conflict('A follow-up can be booked once the consultation has ended', { status: consultation.status }, FollowUpErrorCode.NOT_ALLOWED);
  const existing = await prisma.appointment.findFirst({ where: { followUpOfConsultationId: consultationId, status: { in: ACTIVE } }, select: { id: true } });
  if (existing) throw ApiError.conflict('This consultation already has an active follow-up', { appointmentId: existing.id }, FollowUpErrorCode.EXISTS);
  const slot = await prisma.availabilitySlot.findUnique({ where: { id: slotId }, select: { doctorId: true, status: true, startAtUtc: true } });
  if (!slot || slot.doctorId !== doctor.id) throw ApiError.badRequest('Choose one of your own free slots', [{ path: 'slotId', message: 'Not your slot' }], FollowUpErrorCode.SLOT);
  if (slot.status !== 'AVAILABLE' || slot.startAtUtc <= now) throw ApiError.conflict('That time is no longer free', undefined, FollowUpErrorCode.SLOT);

  const amount = followUpFee(fee, doctor.consultationFee);
  const appointment = await reserveSlot({ patientId: consultation.patientId, slotId, bookingType: 'FOLLOW_UP', followUpOfConsultationId: consultationId, feeAmount: amount, reason: 'Follow-up', now });
  await withTransaction(async (tx) => {
    await notificationEvents.followUpProposed(tx, { appointmentId: appointment.id, fee: amount.toFixed(2), free: amount.isZero() });
    await auditRepository.createAuditLog(tx, {
      actorUserId: auth.user.id,
      action: 'CREATE',
      entityType: 'Appointment',
      entityId: appointment.id,
      newValues: { bookingType: 'FOLLOW_UP', consultationId, amount: amount.toFixed(2), status: 'PENDING_PAYMENT' },
    });
  });
  return { appointmentId: appointment.id, fee: amount.toFixed(2), feeChoice: fee, confirmBy: appointment.holdExpiresAt?.toISOString() ?? null };
}

/**
 * POST /api/v1/appointments/:id/confirm-free (the patient confirms a FREE follow-up before its deadline):
 * CONFIRMED and slot BOOKED without any payment. 409 FOLLOW_UP_NOT_FREE for anything else.
 */
export async function confirmFreeFollowUp(auth, appointmentId, now = new Date()) {
  const patient = await prisma.patientProfile.findUnique({ where: { userId: auth.user.id }, select: { id: true } });
  if (!patient) throw ApiError.forbidden('A patient profile is required', undefined, 'NOT_A_PATIENT');
  await withTransaction(async (tx) => {
    if (!(await lockRow(tx, 'appointments', appointmentId))) throw ApiError.notFound('Appointment not found');
    const a = await appointmentRepository.findAppointmentById(tx, appointmentId);
    if (!a || a.patientId !== patient.id) throw ApiError.notFound('Appointment not found');
    if (!isFreeAppointment(a) || a.status !== 'PENDING_PAYMENT') {
      throw ApiError.conflict('Only a free follow-up waiting for confirmation can be confirmed this way', { status: a.status }, FollowUpErrorCode.NOT_FREE);
    }
    if (!a.holdExpiresAt || a.holdExpiresAt <= now) throw ApiError.conflict('The confirmation deadline has passed', undefined, 'APPOINTMENT_NOT_PAYABLE');
    await appointmentRepository.updateAppointment(tx, a.id, { status: 'CONFIRMED', holdExpiresAt: null });
    await appointmentRepository.recordStatusChange(tx, { appointmentId: a.id, fromStatus: 'PENDING_PAYMENT', toStatus: 'CONFIRMED', reason: 'Free follow-up confirmed by the patient', changedBy: auth.user.id });
    await lockRow(tx, 'availability_slots', a.slotId);
    await appointmentRepository.setSlotStatus(tx, a.slotId, 'BOOKED');
    await notificationEvents.followUpConfirmed(tx, { appointmentId: a.id });
    await auditRepository.createAuditLog(tx, { actorUserId: auth.user.id, action: 'UPDATE', entityType: 'Appointment', entityId: a.id, oldValues: { status: 'PENDING_PAYMENT' }, newValues: { status: 'CONFIRMED', amount: '0.00' } });
  });
  return { confirmed: true };
}
