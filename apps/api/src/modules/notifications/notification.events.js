import { findAdminUserIds } from '../users/user.repository.js';
import { notify } from './notification.service.js';

/**
 * Domain events → notifications. Called by the owning services inside their transactions (`tx`), so a
 * rolled-back action never notifies. Params hold names, times and amounts only — no medical details.
 */

async function parties(tx, appointmentId) {
  const a = await tx.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, startAtUtc: true, patient: { select: { userId: true, user: { select: { fullName: true } } } }, doctor: { select: { userId: true, user: { select: { fullName: true } } } } },
  });
  return {
    id: a.id,
    startAtUtc: a.startAtUtc.toISOString(),
    patient: { userId: a.patient.userId, name: a.patient.user.fullName },
    doctor: { userId: a.doctor.userId, name: a.doctor.user.fullName },
  };
}

/** Tells the patient their slot is reserved and must be paid. */
export async function appointmentReserved(tx, appointmentId) {
  const p = await parties(tx, appointmentId);
  await notify(tx, {
    kind: 'appointment.booked',
    recipients: [{ userId: p.patient.userId, role: 'PATIENT' }],
    params: { appointmentId: p.id, startAtUtc: p.startAtUtc, doctor: p.doctor.name },
    eventKey: `appointment.booked:${p.id}`,
  });
}

/** Payment succeeded → the patient's confirmation and the doctor's "new appointment". */
export async function paymentConfirmed(tx, { appointmentId, paymentId, amount }) {
  const p = await parties(tx, appointmentId);
  await notify(tx, {
    kind: 'payment.confirmed',
    recipients: [{ userId: p.patient.userId, role: 'PATIENT' }],
    params: { appointmentId: p.id, startAtUtc: p.startAtUtc, doctor: p.doctor.name, amount: String(amount) },
    eventKey: `payment.confirmed:${paymentId}`,
  });
  await notify(tx, {
    kind: 'appointment.new',
    recipients: [{ userId: p.doctor.userId, role: 'DOCTOR' }],
    params: { appointmentId: p.id, startAtUtc: p.startAtUtc, patient: p.patient.name },
    eventKey: `appointment.new:${p.id}`,
  });
}

/**
 * Cancellation. `by`: PATIENT | DOCTOR | SYSTEM. The patient is told unless they cancelled themselves;
 * the doctor is told about confirmed (paid) appointments unless they cancelled themselves.
 */
export async function appointmentCancelled(tx, { appointmentId, by, wasConfirmed, refund = false }) {
  const p = await parties(tx, appointmentId);
  const base = { appointmentId: p.id, startAtUtc: p.startAtUtc };
  if (by !== 'PATIENT') {
    await notify(tx, { kind: 'appointment.cancelled', recipients: [{ userId: p.patient.userId, role: 'PATIENT' }], params: { ...base, counterpart: p.doctor.name, refund }, eventKey: `appointment.cancelled:${p.id}` });
  }
  if (by !== 'DOCTOR' && wasConfirmed) {
    await notify(tx, { kind: 'appointment.cancelled', recipients: [{ userId: p.doctor.userId, role: 'DOCTOR' }], params: { ...base, counterpart: p.patient.name }, eventKey: `appointment.cancelled:${p.id}` });
  }
}

/** Tells both parties an appointment moved to a new time. */
export async function appointmentRescheduled(tx, { fromAppointmentId, toAppointmentId }) {
  const p = await parties(tx, toAppointmentId);
  const base = { appointmentId: p.id, startAtUtc: p.startAtUtc, from: fromAppointmentId };
  await notify(tx, { kind: 'appointment.rescheduled', recipients: [{ userId: p.patient.userId, role: 'PATIENT' }], params: { ...base, counterpart: p.doctor.name }, eventKey: `appointment.rescheduled:${p.id}` });
  await notify(tx, { kind: 'appointment.rescheduled', recipients: [{ userId: p.doctor.userId, role: 'DOCTOR' }], params: { ...base, counterpart: p.patient.name }, eventKey: `appointment.rescheduled:${p.id}` });
}

async function refundPatient(tx, refund) {
  const a = await tx.appointment.findUnique({ where: { id: refund.appointmentId }, select: { patient: { select: { userId: true } } } });
  return a?.patient.userId;
}

const admins = async (tx, exclude = null) => (await findAdminUserIds(tx)).filter((id) => id !== exclude).map((userId) => ({ userId, role: 'ADMIN' }));

/** Tells every administrator a refund is waiting to be processed. */
export async function refundRequested(tx, refund) {
  await notify(tx, { kind: 'admin.refund_requested', recipients: await admins(tx), params: { refundId: refund.id, amount: String(refund.amount) }, eventKey: `admin.refund_requested:${refund.id}` });
}

/** Tells the patient their refund was paid out (simulated). */
export async function refundCompleted(tx, refund) {
  await notify(tx, { kind: 'refund.completed', recipients: [{ userId: await refundPatient(tx, refund), role: 'PATIENT' }], params: { refundId: refund.id, amount: String(refund.amount) }, eventKey: `refund.completed:${refund.id}` });
}

/** An administrator declined a refund request → the patient. */
export async function refundRejected(tx, refund) {
  await notify(tx, { kind: 'refund.rejected', recipients: [{ userId: await refundPatient(tx, refund), role: 'PATIENT' }], params: { refundId: refund.id, amount: String(refund.amount) }, eventKey: `refund.rejected:${refund.id}` });
}

/** Tells the patient and administrators a refund failed. */
export async function refundFailed(tx, refund) {
  const params = { refundId: refund.id, amount: String(refund.amount), appointmentId: refund.appointmentId };
  await notify(tx, { kind: 'refund.failed', recipients: [{ userId: await refundPatient(tx, refund), role: 'PATIENT' }], params, eventKey: `refund.failed:${refund.id}` });
  await notify(tx, { kind: 'admin.refund_failed', recipients: await admins(tx), params, eventKey: `admin.refund_failed:${refund.id}` });
}

/** Requirement 11: a doctor passed 3 cancellations this month — every admin is told once. */
export async function doctorCancellationsFlagged(tx, { doctorId, doctorName, count, month }) {
  await notify(tx, { kind: 'admin.doctor_cancellations_flagged', recipients: await admins(tx), params: { doctorId, doctor: doctorName, count: String(count) }, eventKey: `admin.doctor_cancellations_flagged:${doctorId}:${month}` });
}

/** Requirement 12: the doctor booked a follow-up; the patient must confirm (and pay unless free) before the deadline. */
export async function followUpProposed(tx, { appointmentId, fee, free }) {
  const p = await parties(tx, appointmentId);
  await notify(tx, {
    kind: free ? 'followup.proposed.free' : 'followup.proposed',
    recipients: [{ userId: p.patient.userId, role: 'PATIENT' }],
    params: { appointmentId: p.id, startAtUtc: p.startAtUtc, doctor: p.doctor.name, amount: fee },
    eventKey: `followup.proposed:${p.id}`,
  });
}

/** A free follow-up was confirmed by the patient → the doctor is told. */
export async function followUpConfirmed(tx, { appointmentId }) {
  const p = await parties(tx, appointmentId);
  await notify(tx, { kind: 'followup.confirmed', recipients: [{ userId: p.doctor.userId, role: 'DOCTOR' }], params: { appointmentId: p.id, startAtUtc: p.startAtUtc, patient: p.patient.name }, eventKey: `followup.confirmed:${p.id}` });
}

/** Tells administrators a doctor application is waiting for review. */
export async function applicationSubmitted(tx, { requestId, doctorId, applicantName, applicantUserId }) {
  await notify(tx, { kind: 'application.submitted', recipients: await admins(tx, applicantUserId), params: { doctorId, applicant: applicantName }, eventKey: `application.submitted:${requestId}` });
}

const DECISION_KIND = Object.freeze({ START_REVIEW: 'application.review_started', APPROVE: 'application.approved', REJECT: 'application.rejected' });

/** Tells the applicant their application was approved or rejected (or that review started). */
export async function applicationDecided(tx, { decision, requestId, doctorId, doctorUserId }) {
  const kind = DECISION_KIND[decision];
  await notify(tx, { kind, recipients: [{ userId: doctorUserId, role: 'DOCTOR' }], params: { doctorId }, eventKey: `${kind}:${requestId}` });
}

/** Tells a doctor their account was suspended. */
export async function doctorSuspended(tx, { doctorId, doctorUserId, at }) {
  await notify(tx, { kind: 'account.doctor_suspended', recipients: [{ userId: doctorUserId, role: 'DOCTOR' }], params: { doctorId }, eventKey: `account.doctor_suspended:${doctorId}:${at.toISOString()}` });
}

/** Tells a doctor their access is paused until the new licence is verified. */
export async function doctorAccessPaused(tx, { doctorId, doctorUserId, at }) {
  await notify(tx, { kind: 'account.doctor_access_paused', recipients: [{ userId: doctorUserId, role: 'DOCTOR' }], params: { doctorId }, eventKey: `account.doctor_access_paused:${doctorId}:${at.toISOString()}` });
}

/* ------------------------------------------------------------ prescriptions & documents (Phase 10) */
// Params: names, references and ids only — never medicines, doses, diagnoses or file names.

/** Tells the patient a prescription was issued (or replaced). */
export async function prescriptionIssued(tx, { prescriptionId, reference, patientUserId, doctorName, appointmentId, replaced }) {
  const kind = replaced ? 'prescription.replaced' : 'prescription.issued';
  await notify(tx, { kind, recipients: [{ userId: patientUserId, role: 'PATIENT' }], params: { prescriptionId, reference, doctor: doctorName, appointmentId }, eventKey: `${kind}:${prescriptionId}` });
}

/** Tells the patient a prescription was cancelled. */
export async function prescriptionCancelled(tx, { prescriptionId, reference, patientUserId, doctorName }) {
  await notify(tx, { kind: 'prescription.cancelled', recipients: [{ userId: patientUserId, role: 'PATIENT' }], params: { prescriptionId, reference, doctor: doctorName }, eventKey: `prescription.cancelled:${prescriptionId}` });
}

/** Once per consultation: when it is completed with at least one section shared with the patient. */
export async function consultationSummaryAvailable(tx, { consultationId, appointmentId }) {
  const p = await parties(tx, appointmentId);
  await notify(tx, { kind: 'consultation.summary_available', recipients: [{ userId: p.patient.userId, role: 'PATIENT' }], params: { appointmentId, consultationId, doctor: p.doctor.name }, eventKey: `consultation.summary_available:${consultationId}` });
}

/** A document added to a consultation → the other participant. */
export async function documentAdded(tx, { documentId, appointmentId, uploadedBy }) {
  const p = await parties(tx, appointmentId);
  const toPatient = uploadedBy === 'DOCTOR';
  await notify(tx, {
    kind: toPatient ? 'document.shared' : 'document.uploaded',
    recipients: [toPatient ? { userId: p.patient.userId, role: 'PATIENT' } : { userId: p.doctor.userId, role: 'DOCTOR' }],
    params: { appointmentId, doctor: p.doctor.name, patient: p.patient.name },
    eventKey: `document.added:${documentId}`,
  });
}

/* ------------------------------------------------------------ video consultations (Phase 7) */

/** The patient entered the waiting room → the assigned doctor (once per consultation). */
export async function consultationPatientWaiting(tx, { consultationId, appointmentId }) {
  const p = await parties(tx, appointmentId);
  await notify(tx, { kind: 'consultation.patient_waiting', recipients: [{ userId: p.doctor.userId, role: 'DOCTOR' }], params: { appointmentId: p.id, startAtUtc: p.startAtUtc, patient: p.patient.name }, eventKey: `consultation.waiting:${consultationId}` });
}

/** Tells the patient the doctor admitted them to the call. */
export async function consultationAdmitted(tx, { consultationId, appointmentId }) {
  const p = await parties(tx, appointmentId);
  await notify(tx, { kind: 'consultation.admitted', recipients: [{ userId: p.patient.userId, role: 'PATIENT' }], params: { appointmentId: p.id, startAtUtc: p.startAtUtc, doctor: p.doctor.name }, eventKey: `consultation.admitted:${consultationId}` });
}

/** One notification per rejection event (a patient may rejoin and be declined again). */
export async function consultationRejected(tx, { appointmentId, eventId }) {
  const p = await parties(tx, appointmentId);
  await notify(tx, { kind: 'consultation.rejected', recipients: [{ userId: p.patient.userId, role: 'PATIENT' }], params: { appointmentId: p.id, startAtUtc: p.startAtUtc, doctor: p.doctor.name }, eventKey: `consultation.rejected:${eventId}` });
}

/** Tells the patient the consultation ended (summary follows when notes are shared). */
export async function consultationEnded(tx, { consultationId, appointmentId }) {
  const p = await parties(tx, appointmentId);
  await notify(tx, { kind: 'consultation.ended', recipients: [{ userId: p.patient.userId, role: 'PATIENT' }], params: { appointmentId: p.id, startAtUtc: p.startAtUtc, doctor: p.doctor.name }, eventKey: `consultation.ended:${consultationId}` });
}
