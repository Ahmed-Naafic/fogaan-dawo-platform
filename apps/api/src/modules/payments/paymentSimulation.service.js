import { getPaymentProvider, listPaymentProviders } from '../../adapters/payment/index.js';
import { DEMO_WALLET_RULES } from '../../adapters/payment/mockWalletProvider.js';
import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { roundMoney } from '../../utils/money.js';
import { lockRow, rethrowConflict, withTransaction } from '../../utils/transaction.js';
import * as appointmentRepository from '../appointments/appointment.repository.js';
import { expireAppointment } from '../appointments/appointment.service.js';
import * as auditRepository from '../audit/audit.repository.js';
import * as paymentRepository from './payment.repository.js';
import { postSuccessfulPayment } from './payment.service.js';

/**
 * SIMULATED payments (no real provider, no real money). The server asks the provider adapter for the
 * outcome; the browser only chooses the method and wallet and can never claim a result. Only a
 * SUCCESS confirms the appointment. Everything runs in one transaction with the appointment row locked,
 * so double clicks, two tabs or concurrent requests cannot pay twice.
 */

export const PaymentErrorCode = Object.freeze({
  ALREADY_PAID: 'PAYMENT_ALREADY_SUCCEEDED',
  PENDING: 'PAYMENT_PENDING',
  NOT_PAYABLE: 'APPOINTMENT_NOT_PAYABLE',
  WALLET_INVALID: 'WALLET_INVALID',
  IDEMPOTENCY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
});

const maskWallet = (msisdn) => `${msisdn.slice(0, 6)} ••• ${msisdn.slice(-4)}`;

async function patientOf(client, auth) {
  const patient = await appointmentRepository.findPatientByUserId(client, auth.user.id);
  if (!patient) throw ApiError.forbidden('A patient profile is required', undefined, 'PATIENT_PROFILE_REQUIRED');
  return patient;
}

/* ------------------------------------------------------------ presentation */

const attemptOutcome = (a) => a.responseData?.outcome ?? (a.status === 'SUCCEEDED' ? 'SUCCESS' : a.status === 'FAILED' ? 'FAILED' : 'PENDING');

export function presentPayment(p, { forAdmin = false } = {}) {
  if (!p) return null;
  const last = p.attempts?.at(-1) ?? null;
  return {
    id: p.id,
    status: p.status,
    simulated: true,
    provider: p.provider,
    amount: p.amount.toFixed(2),
    currency: p.currency,
    paidAt: p.paidAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    reference: p.attempts?.find((a) => a.status === 'SUCCEEDED')?.providerReference ?? last?.providerReference ?? null,
    lastOutcome: last ? attemptOutcome(last) : null,
    lastMessage: last?.responseData?.message ?? null,
    attempts: (p.attempts ?? []).map((a) => ({
      number: a.attemptNumber,
      status: a.status,
      outcome: attemptOutcome(a),
      reference: a.providerReference,
      wallet: a.responseData?.wallet ?? null,
      message: a.responseData?.message ?? null,
      at: a.createdAt.toISOString(),
    })),
    refunds: (p.refunds ?? []).map((r) => ({ id: r.id, amount: r.amount.toFixed(2), currency: r.currency, status: r.status, reason: r.reason, reference: r.providerReference, createdAt: r.createdAt.toISOString(), processedAt: r.processedAt?.toISOString() ?? null })),
    appointment: p.appointment
      ? {
          id: p.appointment.id,
          status: p.appointment.status,
          startAtUtc: p.appointment.startAtUtc.toISOString(),
          endAtUtc: p.appointment.endAtUtc.toISOString(),
          doctor: { name: p.appointment.doctor.user.fullName, specialty: p.appointment.doctor.specialty },
          ...(forAdmin ? { patient: { name: p.appointment.patient.user.fullName } } : {}),
        }
      : null,
  };
}

/* ------------------------------------------------------------ checkout */

/** What the checkout page needs: the reservation, its payment so far, methods and demo wallet numbers. */
export async function getCheckout(auth, appointmentId, now = new Date()) {
  const patient = await patientOf(prisma, auth);
  const appointment = await appointmentRepository.findAppointmentDetail(prisma, appointmentId);
  if (!appointment || appointment.patientId !== patient.id) throw ApiError.notFound('Appointment not found');
  const payment = await paymentRepository.findPaymentDetailByAppointment(prisma, appointmentId);
  return {
    appointment: {
      id: appointment.id,
      status: appointment.status === 'PENDING_PAYMENT' && appointment.holdExpiresAt && appointment.holdExpiresAt <= now ? 'EXPIRED' : appointment.status,
      fee: appointment.feeAmount.toFixed(2),
      currency: appointment.currency,
      startAtUtc: appointment.startAtUtc.toISOString(),
      endAtUtc: appointment.endAtUtc.toISOString(),
      holdExpiresAt: appointment.status === 'PENDING_PAYMENT' ? appointment.holdExpiresAt?.toISOString() ?? null : null,
      doctor: { name: appointment.doctor.user.fullName, specialty: appointment.doctor.specialty },
    },
    payment: presentPayment(payment),
    providers: listPaymentProviders(),
    demoWallets: { failure: `+25261000${DEMO_WALLET_RULES.fail}`, pending: `+25261000${DEMO_WALLET_RULES.pendingForever}`, pendingThenSuccess: `+25261000${DEMO_WALLET_RULES.pendingThenSuccess}`, refundFails: `+25261000${DEMO_WALLET_RULES.refundFails}` },
    serverTime: now.toISOString(),
  };
}

/** Locks and validates the reservation; returns { appointment, payment } or an EXPIRED result. */
async function lockPayable(tx, patient, appointmentId, now) {
  if (!(await lockRow(tx, 'appointments', appointmentId))) throw ApiError.notFound('Appointment not found');
  const appointment = await appointmentRepository.findAppointmentById(tx, appointmentId);
  if (!appointment || appointment.patientId !== patient.id) throw ApiError.notFound('Appointment not found');
  const payment = await paymentRepository.findPaymentByAppointmentId(tx, appointmentId);
  if (payment?.status === 'SUCCEEDED' || appointment.status === 'CONFIRMED') throw ApiError.conflict('This appointment is already paid', undefined, PaymentErrorCode.ALREADY_PAID);
  if (appointment.status !== 'PENDING_PAYMENT') throw ApiError.conflict(`This appointment is ${appointment.status.toLowerCase()} and cannot be paid`, { status: appointment.status }, PaymentErrorCode.NOT_PAYABLE);
  if (!appointment.holdExpiresAt || appointment.holdExpiresAt <= now) {
    // Phase 4 rule: the hold has run out → expire it and release the slot (this is committed).
    await expireAppointment(tx, appointment, 'Payment window expired');
    return { expired: true, payment };
  }
  return { appointment, payment };
}

/**
 * One payment attempt. `idempotencyKey` (from the Idempotency-Key header) makes a repeated submit return
 * the first result instead of charging again.
 */
export async function payForAppointment(auth, appointmentId, { provider: providerCode, wallet, idempotencyKey }, now = new Date()) {
  const patient = await patientOf(prisma, auth);
  const provider = getPaymentProvider(providerCode);
  if (provider.validateWallet(wallet)) throw ApiError.badRequest('Enter a Somali mobile wallet number, e.g. +252615551234', [{ path: 'wallet', message: 'Invalid wallet number' }], PaymentErrorCode.WALLET_INVALID);

  let result;
  try {
    result = await withTransaction(async (tx) => {
      const previous = await paymentRepository.findAttemptByIdempotencyKey(tx, idempotencyKey);
      if (previous) {
        if (previous.payment.appointmentId !== appointmentId) throw ApiError.conflict('This request key was already used for another payment', undefined, PaymentErrorCode.IDEMPOTENCY_REUSED);
        return { replay: true };
      }
      const locked = await lockPayable(tx, patient, appointmentId, now);
      if (locked.expired) return { outcome: 'EXPIRED' };
      const { appointment } = locked;
      let { payment } = locked;
      if (payment && (await paymentRepository.findAttemptsForPayment(tx, payment.id)).some((a) => a.status === 'INITIATED')) {
        throw ApiError.conflict('A payment is already waiting for approval — check its status instead', undefined, PaymentErrorCode.PENDING);
      }
      await lockRow(tx, 'availability_slots', appointment.slotId);

      const amount = roundMoney(appointment.feeAmount); // always the reserved fee — never an amount from the client
      if (!payment) {
        payment = await paymentRepository.createPayment(tx, { appointmentId, patientId: patient.id, provider: provider.code, amount, currency: appointment.currency, status: 'PENDING' });
      }
      const attempts = await paymentRepository.findAttemptsForPayment(tx, payment.id);
      const charge = await provider.charge({ amount: amount.toFixed(2), currency: appointment.currency, msisdn: wallet, reference: payment.id });
      const status = charge.outcome === 'SUCCESS' ? 'SUCCEEDED' : charge.outcome === 'FAILED' ? 'FAILED' : 'INITIATED';
      const attempt = await paymentRepository.createPaymentAttempt(tx, {
        paymentId: payment.id,
        attemptNumber: attempts.length + 1,
        idempotencyKey,
        providerReference: charge.providerReference,
        status,
        responseData: { simulated: true, outcome: charge.outcome, message: charge.message, wallet: maskWallet(wallet), walletLast4: wallet.slice(-4), provider: provider.code },
      });
      const paymentStatus = charge.outcome === 'SUCCESS' ? 'SUCCEEDED' : charge.outcome === 'FAILED' ? 'FAILED' : 'PENDING';
      payment = await paymentRepository.updatePayment(tx, payment.id, { status: paymentStatus, provider: provider.code, ...(charge.outcome === 'SUCCESS' ? { paidAt: now } : {}) });
      if (charge.outcome === 'SUCCESS') await postSuccessfulPayment(tx, { appointment, payment });
      await auditRepository.createAuditLog(tx, {
        actorUserId: auth.user.id,
        action: 'CREATE',
        entityType: 'PaymentAttempt',
        entityId: attempt.id,
        newValues: { simulated: true, paymentId: payment.id, appointmentId, provider: provider.code, outcome: charge.outcome, reference: charge.providerReference, amount: amount.toFixed(2) },
      });
      return { outcome: charge.outcome };
    });
  } catch (error) {
    rethrowConflict(error, 'This payment request was already received');
  }
  const payment = await paymentRepository.findPaymentDetailByAppointment(prisma, appointmentId);
  return { outcome: result.replay ? payment?.attempts.at(-1) && attemptOutcome(payment.attempts.at(-1)) : result.outcome, replayed: !!result.replay, payment: presentPayment(payment) };
}

/** Asks the (simulated) provider again about a PENDING attempt; expires it if the reservation ran out. */
export async function refreshPayment(auth, appointmentId, now = new Date()) {
  const patient = await patientOf(prisma, auth);
  const result = await withTransaction(async (tx) => {
    if (!(await lockRow(tx, 'appointments', appointmentId))) throw ApiError.notFound('Appointment not found');
    const appointment = await appointmentRepository.findAppointmentById(tx, appointmentId);
    if (!appointment || appointment.patientId !== patient.id) throw ApiError.notFound('Appointment not found');
    const payment = await paymentRepository.findPaymentByAppointmentId(tx, appointmentId);
    const pending = payment ? (await paymentRepository.findAttemptsForPayment(tx, payment.id)).find((a) => a.status === 'INITIATED') : null;
    if (!pending) return { outcome: payment?.status === 'SUCCEEDED' ? 'SUCCESS' : appointment.status === 'EXPIRED' ? 'EXPIRED' : payment?.status === 'FAILED' ? 'FAILED' : 'NONE' };
    if (appointment.status !== 'PENDING_PAYMENT' || !appointment.holdExpiresAt || appointment.holdExpiresAt <= now) {
      if (appointment.status === 'PENDING_PAYMENT') await expireAppointment(tx, appointment, 'Payment window expired while waiting for approval');
      else await paymentRepository.closeOpenPaymentForAppointment(tx, appointmentId, 'Reservation no longer payable');
      return { outcome: 'EXPIRED' };
    }
    const provider = getPaymentProvider(payment.provider);
    const status = await provider.checkStatus({ msisdn: `…${pending.responseData?.walletLast4 ?? ''}`, providerReference: pending.providerReference, checks: 1 });
    if (status.outcome === 'PENDING') return { outcome: 'PENDING' };
    await lockRow(tx, 'availability_slots', appointment.slotId);
    await paymentRepository.updatePaymentAttempt(tx, pending.id, { status: status.outcome === 'SUCCESS' ? 'SUCCEEDED' : 'FAILED', responseData: { ...pending.responseData, outcome: status.outcome, message: status.message } });
    const updated = await paymentRepository.updatePayment(tx, payment.id, { status: status.outcome === 'SUCCESS' ? 'SUCCEEDED' : 'FAILED', ...(status.outcome === 'SUCCESS' ? { paidAt: now } : {}) });
    if (status.outcome === 'SUCCESS') await postSuccessfulPayment(tx, { appointment, payment: updated });
    await auditRepository.createAuditLog(tx, { actorUserId: auth.user.id, action: 'UPDATE', entityType: 'PaymentAttempt', entityId: pending.id, oldValues: { outcome: 'PENDING' }, newValues: { simulated: true, outcome: status.outcome } });
    return { outcome: status.outcome };
  });
  return { outcome: result.outcome, payment: presentPayment(await paymentRepository.findPaymentDetailByAppointment(prisma, appointmentId)) };
}

/* ------------------------------------------------------------ history and receipts */

export async function listMyPayments(auth) {
  const patient = await patientOf(prisma, auth);
  return (await paymentRepository.listPaymentsForPatient(prisma, patient.id)).map((p) => presentPayment(p));
}

/** Receipt data for a SUCCEEDED payment: the owner (patient) or an administrator only. */
export async function getReceipt(auth, paymentId, { asAdmin = false } = {}) {
  const payment = await paymentRepository.findPaymentDetail(prisma, paymentId);
  if (!payment) throw ApiError.notFound('Payment not found');
  if (!asAdmin) {
    const patient = await patientOf(prisma, auth);
    if (payment.patientId !== patient.id) throw ApiError.notFound('Payment not found');
  }
  if (payment.status !== 'SUCCEEDED') throw ApiError.conflict('Receipts are issued for successful payments only', undefined, 'RECEIPT_UNAVAILABLE');
  return presentPayment(payment, { forAdmin: true });
}
