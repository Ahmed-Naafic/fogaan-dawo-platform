import { ApiError } from '../../utils/ApiError.js';
import { cancelRemindersForAppointment } from '../notifications/reminder.service.js';
import { lockRow, rethrowConflict, withTransaction } from '../../utils/transaction.js';
import * as consultationRepository from '../consultations/consultation.repository.js';
import * as doctorRepository from '../doctors/doctor.repository.js';
import * as patientRepository from '../patients/patient.repository.js';
import { getCommissionRate } from '../settings/setting.service.js';
import * as paymentRepository from '../payments/payment.repository.js';
import * as appointmentRepository from './appointment.repository.js';
import { FOLLOW_UP_DEADLINE_HOURS, PAYMENT_HOLD_MINUTES } from './appointment.constants.js';

const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60_000);

/**
 * Expires one pending appointment and releases its slot. Caller must hold the appointment lock.
 * An unfinished payment for it is closed too: open attempts become FAILED (outcome EXPIRED) and the
 * payment CANCELLED — an expired reservation can never be confirmed afterwards.
 */
export async function expireAppointment(tx, appointment, reason) {
  await paymentRepository.closeOpenPaymentForAppointment(tx, appointment.id, reason);
  await appointmentRepository.updateAppointment(tx, appointment.id, { status: 'EXPIRED', holdExpiresAt: null });
  await appointmentRepository.recordStatusChange(tx, { appointmentId: appointment.id, fromStatus: 'PENDING_PAYMENT', toStatus: 'EXPIRED', reason });
  await lockRow(tx, 'availability_slots', appointment.slotId);
  await appointmentRepository.setSlotStatus(tx, appointment.slotId, 'AVAILABLE');
}

async function followUpDeadline(tx, { patientId, slot, followUpOfConsultationId, now }) {
  const consultation = followUpOfConsultationId ? await consultationRepository.findConsultationById(tx, followUpOfConsultationId) : null;
  if (!consultation || consultation.status !== 'COMPLETED' || consultation.patientId !== patientId || consultation.doctorId !== slot.doctorId) {
    throw ApiError.badRequest('A follow-up must reference a completed consultation between the same patient and doctor');
  }
  const deadline = addMinutes(now, FOLLOW_UP_DEADLINE_HOURS * 60);
  return deadline > slot.startAtUtc ? slot.startAtUtc : deadline;
}

/**
 * Reserves a slot for a patient: locks the slot, checks the doctor is verified and active, creates a
 * PENDING_PAYMENT appointment with a payment deadline (10 min standard, 48 h follow-up) and marks the
 * slot HELD. A stale hold on the slot is expired first. One transaction, slot row locked throughout.
 */
export async function reserveSlot({ patientId, slotId, reason = null, bookingType = 'STANDARD', followUpOfConsultationId = null, now = new Date() }) {
  try {
    return await withTransaction(async (tx) => {
      if (!(await lockRow(tx, 'availability_slots', slotId))) throw ApiError.notFound('Slot not found');
      const slot = await appointmentRepository.findSlotById(tx, slotId);

      if (slot.startAtUtc <= now) throw ApiError.conflict('Slot is in the past');
      if (slot.status === 'HELD') {
        const holder = await appointmentRepository.findPendingAppointmentForSlot(tx, slotId);
        if (!holder || !holder.holdExpiresAt || holder.holdExpiresAt > now) throw ApiError.conflict('Slot is currently held by another booking');
        await lockRow(tx, 'appointments', holder.id);
        await expireAppointment(tx, holder, 'Payment window expired before a new reservation');
      } else if (slot.status !== 'AVAILABLE') {
        throw ApiError.conflict(`Slot is not available (${slot.status})`);
      }

      const doctor = await doctorRepository.findBookableDoctor(tx, slot.doctorId);
      if (!doctor) throw ApiError.conflict('Doctor is not verified or not active');
      if (!(await patientRepository.findPatientById(tx, patientId))) throw ApiError.notFound('Patient not found');

      let deadline;
      if (bookingType === 'FOLLOW_UP') {
        deadline = await followUpDeadline(tx, { patientId, slot, followUpOfConsultationId, now });
      } else if (followUpOfConsultationId) {
        throw ApiError.badRequest('followUpOfConsultationId is only valid for FOLLOW_UP bookings');
      } else {
        deadline = addMinutes(now, PAYMENT_HOLD_MINUTES);
      }

      const appointment = await appointmentRepository.createAppointment(tx, {
        patientId,
        doctorId: slot.doctorId,
        slotId,
        bookingType,
        reason,
        feeAmount: doctor.consultationFee,
        currency: doctor.currency,
        commissionRateSnapshot: await getCommissionRate(tx),
        startAtUtc: slot.startAtUtc,
        endAtUtc: slot.endAtUtc,
        holdExpiresAt: deadline,
        followUpOfConsultationId,
      });
      await appointmentRepository.recordStatusChange(tx, { appointmentId: appointment.id, fromStatus: null, toStatus: 'PENDING_PAYMENT' });
      await appointmentRepository.setSlotStatus(tx, slotId, 'HELD', deadline);
      return appointment;
    });
  } catch (error) {
    rethrowConflict(error, 'Slot already has an active booking');
  }
}

/** Expires every PENDING_PAYMENT appointment past its deadline and releases the slots. Safe to run concurrently. */
export async function expireStaleHolds({ now = new Date(), limit = 100 } = {}) {
  return withTransaction(async (tx) => {
    const rows = await appointmentRepository.lockExpiredHolds(tx, now, limit);
    for (const { id } of rows) {
      await expireAppointment(tx, await appointmentRepository.findAppointmentById(tx, id), 'Payment window expired');
    }
    return rows.length;
  });
}

/**
 * Cancels an appointment the caller has already locked (status PENDING_PAYMENT or CONFIRMED) and sets
 * its slot to `slotStatus` (AVAILABLE = offered again; CANCELLED = withdrawn, e.g. the doctor cancelled).
 * A slot that has already started is never offered again.
 */
export async function cancelLockedAppointment(tx, appointment, { reason, changedBy = null, now = new Date(), slotStatus = 'AVAILABLE' }) {
  if (!['PENDING_PAYMENT', 'CONFIRMED'].includes(appointment.status)) {
    throw ApiError.conflict(`Cannot cancel a ${appointment.status} appointment`, { status: appointment.status }, 'APPOINTMENT_NOT_CANCELLABLE');
  }
  const updated = await appointmentRepository.updateAppointment(tx, appointment.id, {
    status: 'CANCELLED',
    cancelledAt: now,
    cancellationReason: reason,
    holdExpiresAt: null,
  });
  await appointmentRepository.recordStatusChange(tx, { appointmentId: appointment.id, fromStatus: appointment.status, toStatus: 'CANCELLED', reason, changedBy });
  await cancelRemindersForAppointment(tx, appointment.id);
  await lockRow(tx, 'availability_slots', appointment.slotId);
  const slot = await appointmentRepository.findSlotById(tx, appointment.slotId);
  await appointmentRepository.setSlotStatus(tx, appointment.slotId, slotStatus === 'AVAILABLE' && slot.startAtUtc <= now ? 'CANCELLED' : slotStatus);
  return updated;
}

/** Cancels a pending or confirmed appointment and releases the slot for new bookings. */
export async function cancelAppointment({ appointmentId, reason, changedBy = null, now = new Date() }) {
  return withTransaction(async (tx) => {
    if (!(await lockRow(tx, 'appointments', appointmentId))) throw ApiError.notFound('Appointment not found');
    const appointment = await appointmentRepository.findAppointmentById(tx, appointmentId);
    return cancelLockedAppointment(tx, appointment, { reason, changedBy, now });
  });
}
