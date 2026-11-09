import { prisma } from '../../config/database.js';
import { iceServersForCall } from '../../config/webrtc.js';
import { ApiError } from '../../utils/ApiError.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as appointmentRepository from '../appointments/appointment.repository.js';
import * as doctorRepository from '../doctors/doctor.repository.js';
import * as notificationEvents from '../notifications/notification.events.js';
import { findPaymentForAppointment } from '../refunds/refund.service.js';
import { ConsultationErrorCode as Code } from './consultation.constants.js';
import { admissionState, joinBlocker, joinWindow } from './consultation.policy.js';
import { isFreeAppointment } from '../appointments/followUp.service.js';
import * as repo from './consultation.repository.js';
import { completeLockedConsultation } from './consultation.service.js';
import * as hub from './consultation.signaling.js';
import { issueTicket } from './consultation.tickets.js';
import { assignedDoctorPhotoPath } from '../medical-history/medicalHistory.constants.js';

/**
 * Video consultation lifecycle (Phase 7). Every rule is enforced here, on the server:
 *  - only the appointment's own patient, or its assigned doctor (verified and active), may take part;
 *  - the appointment must be CONFIRMED/WAITING/IN_PROGRESS, covered by a SUCCEEDED payment with no
 *    refund, and inside the join window [start − 10 min, start + 30 min];
 *  - the patient waits until the assigned doctor admits (or rejects) them; only the doctor ends the call.
 * Server timestamps are the only source of truth for start, end and duration.
 * The participant role is the session's active role (PATIENT or DOCTOR), checked by the router.
 */

const BLOCKER_ERRORS = Object.freeze({
  NOT_JOINABLE: [409, 'This appointment cannot be joined', Code.NOT_JOINABLE],
  NOT_PAID: [409, 'This appointment has not been paid', Code.NOT_PAID],
  TOO_EARLY: [409, 'The consultation is not open yet', Code.TOO_EARLY],
  TOO_LATE: [409, 'The consultation window has closed', Code.TOO_LATE],
  ENDED: [409, 'This consultation has ended', Code.ENDED],
});

function blockerError(blocker, appointment) {
  const [status, message, code] = BLOCKER_ERRORS[blocker];
  const { opensAt, closesAt } = joinWindow(appointment);
  return new ApiError(status, message, { opensAt: opensAt.toISOString(), closesAt: closesAt.toISOString() }, code);
}

/** Payment status covering the appointment, and whether any refund of it is pending or paid. */
export async function paymentEligibility(tx, appointmentId) {
  const paid = await findPaymentForAppointment(tx, appointmentId);
  if (!paid) {
    // A free follow-up (fee 0) is covered without a payment once the patient has confirmed it.
    const a = await tx.appointment.findUnique({ where: { id: appointmentId }, select: { bookingType: true, feeAmount: true, status: true } });
    return { paymentStatus: isFreeAppointment(a) && a.status !== 'PENDING_PAYMENT' ? 'SUCCEEDED' : null, refunded: false };
  }
  const refunds = await tx.refund.count({ where: { paymentId: paid.payment.id, status: { not: 'FAILED' } } });
  return { paymentStatus: paid.payment.status, refunded: refunds > 0 };
}

/** Loads the appointment and checks that the signed-in user is its patient / assigned doctor. */
async function loadOwnedAppointment(tx, auth, appointmentId) {
  const a = await repo.findCallAppointment(tx, appointmentId);
  const owner = auth.activeRole === 'DOCTOR' ? a?.doctor.userId : a?.patient.userId;
  // Someone else's appointment is indistinguishable from a missing one (existing convention).
  if (!a || owner !== auth.user.id) throw ApiError.notFound('Appointment not found');
  if (auth.activeRole === 'DOCTOR' && !(await doctorRepository.findBookableDoctor(tx, a.doctorId))) {
    throw ApiError.forbidden('Your doctor account is not active or not verified', undefined, Code.DOCTOR_NOT_ACTIVE);
  }
  return a;
}

/**
 * Loads a consultation the signed-in user takes part in. With `lock`, rows are locked in the same order
 * as join (appointment, then consultation) so concurrent actions cannot deadlock.
 */
async function loadOwnedConsultation(tx, auth, consultationId, { lock = false } = {}) {
  let c = await repo.findConsultationById(tx, consultationId);
  if (!c) throw ApiError.notFound('Consultation not found');
  if (lock) {
    await lockRow(tx, 'appointments', c.appointmentId);
    await lockRow(tx, 'consultations', c.id);
    c = await repo.findConsultationById(tx, consultationId);
  }
  const a = await loadOwnedAppointment(tx, auth, c.appointmentId).catch((error) => {
    throw error.status === 404 ? ApiError.notFound('Consultation not found') : error;
  });
  return { c, a };
}

async function assertJoinable(tx, a, c, now) {
  const { paymentStatus, refunded } = await paymentEligibility(tx, a.id);
  const blocker = joinBlocker({ appointment: a, consultation: c, paymentStatus, refunded, now });
  if (blocker) throw blockerError(blocker, a);
}

/** Moves the appointment (whose row the caller has locked and loaded as `a`) and records the history. */
async function moveAppointment(tx, a, { from, to, reason, changedBy }) {
  if (!from.includes(a.status)) return;
  await appointmentRepository.updateAppointment(tx, a.id, { status: to });
  await appointmentRepository.recordStatusChange(tx, { appointmentId: a.id, fromStatus: a.status, toStatus: to, reason, changedBy });
  a.status = to; // keep the in-memory row current for presentation
}

const doctorOnly = (auth) => {
  if (auth.activeRole !== 'DOCTOR') throw ApiError.forbidden('Only the assigned doctor can do this', undefined, Code.DOCTOR_ONLY);
};

/* ------------------------------------------------------------ presentation */

async function presentState(client, { c, a }, role, now) {
  const events = c ? await repo.listEvents(client, c.id) : [];
  const { opensAt, closesAt } = joinWindow(a);
  const note = role === 'DOCTOR' && c ? await repo.findNoteByConsultationId(client, c.id) : null;
  return {
    id: c?.id ?? null,
    appointmentId: a.id,
    role,
    status: c?.status ?? null,
    admission: admissionState(c, events),
    appointment: { status: a.status, startAtUtc: a.startAtUtc.toISOString(), endAtUtc: a.endAtUtc.toISOString() },
    window: { opensAt: opensAt.toISOString(), closesAt: closesAt.toISOString() },
    patient: {
      ...(role === 'DOCTOR'
        ? { id: a.patientId, photoUrl: assignedDoctorPhotoPath({ patientId: a.patientId, appointmentId: a.id, status: a.status, avatarUpdatedAt: a.patient.user.avatarUpdatedAt }) }
        : {}),
      name: a.patient.user.fullName,
    },
    doctor: { name: a.doctor.user.fullName },
    startedAt: c?.startedAt?.toISOString() ?? null,
    admittedAt: c?.admittedAt?.toISOString() ?? null,
    endedAt: c?.endedAt?.toISOString() ?? null,
    durationSeconds: c?.durationSeconds ?? null,
    endedBy: c?.endedBy ?? null,
    presence: c ? hub.presence(c.id) : { patient: false, doctor: false },
    ...(role === 'DOCTOR'
      ? {
          note: note
            ? {
                complaint: note.complaint,
                assessment: note.assessment,
                diagnosis: note.diagnosis,
                advice: note.advice,
                shareComplaint: note.shareComplaint,
                shareAssessment: note.shareAssessment,
                shareDiagnosis: note.shareDiagnosis,
                shareAdvice: note.shareAdvice,
                lockedAt: note.lockedAt?.toISOString() ?? null,
              }
            : null,
        }
      : {}),
    serverTime: now.toISOString(),
  };
}

/* ------------------------------------------------------------ actions */

/**
 * Join: verifies eligibility, creates the consultation once (the appointment row is locked, and
 * appointment_id is unique), records PATIENT_JOINED / DOCTOR_JOINED, puts a joining patient in the
 * waiting room and returns the state, a single-use signaling ticket and the ICE servers.
 */
export async function join(auth, appointmentId, now = new Date()) {
  const role = auth.activeRole;
  const { c, a } = await withTransaction(async (tx) => {
    if (!(await lockRow(tx, 'appointments', appointmentId))) throw ApiError.notFound('Appointment not found');
    const appt = await loadOwnedAppointment(tx, auth, appointmentId);
    await assertJoinable(tx, appt, appt.consultation, now);
    const consultation = appt.consultation ?? (await repo.createConsultation(tx, { appointmentId: appt.id, patientId: appt.patientId, doctorId: appt.doctorId }));
    await repo.addEvent(tx, { consultationId: consultation.id, eventType: role === 'DOCTOR' ? 'DOCTOR_JOINED' : 'PATIENT_JOINED', participantRole: role, occurredAt: now });
    if (role === 'PATIENT' && consultation.status === 'WAITING') {
      const first = appt.status === 'CONFIRMED';
      await moveAppointment(tx, appt, { from: ['CONFIRMED'], to: 'WAITING', reason: 'Patient joined the waiting room', changedBy: auth.user.id });
      if (first) await notificationEvents.consultationPatientWaiting(tx, { consultationId: consultation.id, appointmentId: appt.id });
    }
    return { c: consultation, a: appt };
  }, { timeout: 45_000 });
  hub.stateChanged(c.id);
  const { ticket, expiresAt } = issueTicket({ userId: auth.user.id, role, consultationId: c.id });
  return {
    consultation: await presentState(prisma, { c, a }, role, now),
    signaling: { ticket, expiresAt: expiresAt.toISOString(), path: hub.SIGNAL_PATH },
    iceServers: await iceServersForCall({ userId: auth.user.id, consultationId: c.id }),
  };
}

/** A fresh signaling ticket for reconnecting (the same checks as join, without a new join event). */
export async function reconnectTicket(auth, consultationId, now = new Date()) {
  const { c, a } = await loadOwnedConsultation(prisma, auth, consultationId);
  await assertJoinable(prisma, a, c, now);
  const { ticket, expiresAt } = issueTicket({ userId: auth.user.id, role: auth.activeRole, consultationId: c.id });
  return { signaling: { ticket, expiresAt: expiresAt.toISOString(), path: hub.SIGNAL_PATH }, iceServers: await iceServersForCall({ userId: auth.user.id, consultationId: c.id }) };
}

/** GET /api/v1/consultations/:id: call state for a participant (admission, presence, timer, note for the doctor). */
export async function getState(auth, consultationId, now = new Date()) {
  return presentState(prisma, await loadOwnedConsultation(prisma, auth, consultationId), auth.activeRole, now);
}

/** Doctor admits the waiting patient: IN_PROGRESS, startedAt (once), DOCTOR_ADMITTED + CALL_STARTED. */
export async function admit(auth, consultationId, now = new Date()) {
  const id = await withTransaction(async (tx) => {
    const { c, a } = await loadOwnedConsultation(tx, auth, consultationId, { lock: true });
    doctorOnly(auth);
    await assertJoinable(tx, a, c, now);
    const admission = admissionState(c, await repo.listEvents(tx, c.id));
    if (admission !== 'WAITING') throw ApiError.conflict('No patient is waiting to be admitted', { admission }, Code.PATIENT_NOT_WAITING);
    await repo.updateConsultation(tx, c.id, { status: 'IN_PROGRESS', admittedAt: c.admittedAt ?? now, startedAt: c.startedAt ?? now });
    await repo.addEvent(tx, { consultationId: c.id, eventType: 'DOCTOR_ADMITTED', participantRole: 'DOCTOR', occurredAt: now });
    await repo.addEvent(tx, { consultationId: c.id, eventType: 'CALL_STARTED', participantRole: 'DOCTOR', occurredAt: now });
    await moveAppointment(tx, a, { from: ['CONFIRMED', 'WAITING'], to: 'IN_PROGRESS', reason: 'Doctor admitted the patient', changedBy: auth.user.id });
    await notificationEvents.consultationAdmitted(tx, { consultationId: c.id, appointmentId: a.id });
    return c.id;
  });
  hub.stateChanged(id);
  return getState(auth, id, now);
}

/** Doctor declines to admit the waiting patient now. Nothing is completed or cancelled. */
export async function reject(auth, consultationId, now = new Date()) {
  const id = await withTransaction(async (tx) => {
    const { c, a } = await loadOwnedConsultation(tx, auth, consultationId, { lock: true });
    doctorOnly(auth);
    const admission = admissionState(c, await repo.listEvents(tx, c.id));
    if (admission !== 'WAITING') throw ApiError.conflict('No patient is waiting to be admitted', { admission }, Code.PATIENT_NOT_WAITING);
    const event = await repo.addEvent(tx, { consultationId: c.id, eventType: 'DOCTOR_REJECTED', participantRole: 'DOCTOR', occurredAt: now });
    await notificationEvents.consultationRejected(tx, { consultationId: c.id, appointmentId: a.id, eventId: event.id });
    return c.id;
  });
  hub.stateChanged(id);
  return getState(auth, id, now);
}

/** Intentional leave (either participant). The call is NOT completed; the doctor can still end it. */
export async function leave(auth, consultationId, now = new Date()) {
  const role = auth.activeRole;
  const id = await withTransaction(async (tx) => {
    const { c } = await loadOwnedConsultation(tx, auth, consultationId, { lock: true });
    if (c.status === 'WAITING' || c.status === 'IN_PROGRESS') {
      await repo.addEvent(tx, { consultationId: c.id, eventType: role === 'DOCTOR' ? 'DOCTOR_LEFT' : 'PATIENT_LEFT', participantRole: role, occurredAt: now });
    }
    return c.id;
  });
  hub.disconnect(id, role);
  hub.stateChanged(id);
  return getState(auth, id, now);
}

/**
 * Doctor ends the call: COMPLETED with server end time and duration (existing completion + note-lock
 * rules), CALL_ENDED, ended_by DOCTOR, appointment COMPLETED, patient notified.
 */
export async function end(auth, consultationId, now = new Date()) {
  const id = await withTransaction(async (tx) => {
    const { c, a } = await loadOwnedConsultation(tx, auth, consultationId, { lock: true });
    doctorOnly(auth);
    if (c.status === 'COMPLETED') throw ApiError.conflict('This consultation has already ended', undefined, Code.ENDED);
    if (c.status !== 'IN_PROGRESS') throw ApiError.conflict('The call has not started', undefined, Code.NOT_JOINABLE);
    await completeLockedConsultation(tx, c, { now, endedBy: 'DOCTOR' });
    await repo.addEvent(tx, { consultationId: c.id, eventType: 'CALL_ENDED', participantRole: 'DOCTOR', occurredAt: now });
    await moveAppointment(tx, a, { from: ['IN_PROGRESS', 'WAITING', 'CONFIRMED'], to: 'COMPLETED', reason: 'Consultation completed', changedBy: auth.user.id });
    await notificationEvents.consultationEnded(tx, { consultationId: c.id, appointmentId: a.id });
    return c.id;
  });
  hub.stateChanged(id);
  return getState(auth, id, now);
}
