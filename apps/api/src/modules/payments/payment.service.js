import { ApiError } from '../../utils/ApiError.js';
import { roundMoney } from '../../utils/money.js';
import * as notificationEvents from '../notifications/notification.events.js';
import { splitPayment } from '../finance/finance.calc.js';
import { lockRow, rethrowConflict, withTransaction } from '../../utils/transaction.js';
import * as appointmentRepository from '../appointments/appointment.repository.js';
import { LedgerReference } from '../ledger/ledger.constants.js';
import * as ledgerRepository from '../ledger/ledger.repository.js';
import * as paymentRepository from './payment.repository.js';

/**
 * The single "money received" step, inside the caller's transaction (appointment and slot locked, payment
 * already SUCCEEDED): ledger entries PAYMENT = PLATFORM_COMMISSION + DOCTOR_EARNING (commission from the
 * appointment's rate snapshot — a platform setting, not a constant), the doctor earning, appointment
 * CONFIRMED and slot BOOKED. Ledger references are deterministic, so it can never be posted twice.
 */
export async function postSuccessfulPayment(tx, { appointment, payment }) {
  const { gross, commission, net } = splitPayment(appointment.feeAmount, appointment.commissionRateSnapshot);
  const { currency } = appointment;
  // Snapshot of what was applied, kept with every entry (historical reports never use the current rate).
  const metadata = { appointmentId: appointment.id, patientId: appointment.patientId, doctorId: appointment.doctorId, commissionRate: String(appointment.commissionRateSnapshot), source: 'SYSTEM' };
  await ledgerRepository.postEntry(tx, { type: 'PAYMENT', amount: gross, currency, reference: LedgerReference.payment(payment.id), paymentId: payment.id, metadata });
  await ledgerRepository.postEntry(tx, { type: 'PLATFORM_COMMISSION', amount: commission, currency, reference: LedgerReference.commission(payment.id), paymentId: payment.id, metadata });
  await ledgerRepository.postEntry(tx, { type: 'DOCTOR_EARNING', amount: net, currency, reference: LedgerReference.doctorEarning(payment.id), paymentId: payment.id, metadata });
  await paymentRepository.createDoctorEarning(tx, { appointmentId: appointment.id, doctorId: appointment.doctorId, grossAmount: gross, commissionAmount: commission, netAmount: net, currency });
  await appointmentRepository.updateAppointment(tx, appointment.id, { status: 'CONFIRMED', holdExpiresAt: null });
  await appointmentRepository.recordStatusChange(tx, { appointmentId: appointment.id, fromStatus: 'PENDING_PAYMENT', toStatus: 'CONFIRMED', reason: 'Payment succeeded' });
  await appointmentRepository.setSlotStatus(tx, appointment.slotId, 'BOOKED');
  await notificationEvents.paymentConfirmed(tx, { appointmentId: appointment.id, paymentId: payment.id, amount: gross.toFixed(2) });
}

/**
 * Records a provider-confirmed payment for a PENDING_PAYMENT appointment, in one transaction:
 * payment + attempt, ledger entries (PAYMENT = PLATFORM_COMMISSION + DOCTOR_EARNING), doctor earning,
 * appointment CONFIRMED, slot BOOKED. Idempotent on `idempotencyKey`.
 * Rejects (and changes nothing) once the payment window has passed; expireStaleHolds releases the slot.
 * Provider integration (EVC Plus / Zaad / eDahab) is out of scope here: the caller passes the confirmed result.
 */
export async function recordSuccessfulPayment({ appointmentId, provider, providerReference = null, idempotencyKey, responseData, now = new Date() }) {
  if (!idempotencyKey) throw ApiError.badRequest('idempotencyKey is required');
  try {
    return await withTransaction(async (tx) => {
      const previous = await paymentRepository.findAttemptByIdempotencyKey(tx, idempotencyKey);
      if (previous) {
        if (previous.payment.appointmentId !== appointmentId) throw ApiError.conflict('idempotencyKey was used for a different appointment');
        return previous.payment;
      }

      if (!(await lockRow(tx, 'appointments', appointmentId))) throw ApiError.notFound('Appointment not found');
      const appointment = await appointmentRepository.findAppointmentById(tx, appointmentId);
      if (appointment.status !== 'PENDING_PAYMENT') throw ApiError.conflict(`Appointment is ${appointment.status}, not awaiting payment`);
      if (!appointment.holdExpiresAt || appointment.holdExpiresAt <= now) throw ApiError.conflict('Payment window has expired');
      await lockRow(tx, 'availability_slots', appointment.slotId);

      const payment = await paymentRepository.createPayment(tx, {
        appointmentId,
        patientId: appointment.patientId,
        provider,
        amount: roundMoney(appointment.feeAmount),
        currency: appointment.currency,
        status: 'SUCCEEDED',
        paidAt: now,
      });
      await paymentRepository.createPaymentAttempt(tx, { paymentId: payment.id, attemptNumber: 1, idempotencyKey, providerReference, status: 'SUCCEEDED', responseData });
      await postSuccessfulPayment(tx, { appointment, payment });
      return payment;
    });
  } catch (error) {
    rethrowConflict(error, 'Appointment already has a payment');
  }
}
