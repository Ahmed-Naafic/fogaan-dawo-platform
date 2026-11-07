/** Consultation notes can be edited for 24 hours after the consultation is completed, then lock. */
export const NOTE_EDIT_WINDOW_HOURS = 24;

export const NOTE_FIELDS = Object.freeze(['complaint', 'assessment', 'diagnosis', 'advice', 'shareComplaint', 'shareAssessment', 'shareDiagnosis', 'shareAdvice']);

/** Approved join window: from 10 minutes before the scheduled start until 15 minutes after the scheduled end. */
export const JOIN_EARLY_MINUTES = 10;
export const JOIN_LATE_MINUTES = 15;

/** Appointment statuses in which a call can be joined (payment is checked separately). */
export const JOINABLE_APPOINTMENT_STATUSES = Object.freeze(['CONFIRMED', 'WAITING', 'IN_PROGRESS']);

/** Signaling tickets: random, single-use, short-lived. */
export const SIGNAL_TICKET_TTL_SECONDS = 60;

/** Stable error codes returned with 403/404/409 responses (the web app translates them). */
export const ConsultationErrorCode = Object.freeze({
  NOT_JOINABLE: 'CONSULTATION_NOT_JOINABLE',
  NOT_PAID: 'CONSULTATION_NOT_PAID',
  TOO_EARLY: 'CONSULTATION_TOO_EARLY',
  TOO_LATE: 'CONSULTATION_TOO_LATE',
  ENDED: 'CONSULTATION_ENDED',
  DOCTOR_NOT_ACTIVE: 'DOCTOR_NOT_ACTIVE',
  PATIENT_NOT_WAITING: 'PATIENT_NOT_WAITING',
  DOCTOR_ONLY: 'CONSULTATION_DOCTOR_ONLY',
});
