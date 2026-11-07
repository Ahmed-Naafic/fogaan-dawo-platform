/**
 * Appointment statuses that let the ASSIGNED doctor read a patient's information (verified against the
 * AppointmentStatus enum): CONFIRMED (paid), WAITING (patient in the waiting room), IN_PROGRESS (in the
 * call), COMPLETED. Never PENDING_PAYMENT, EXPIRED, CANCELLED, NO_SHOW or RESCHEDULED.
 */
export const DOCTOR_READ_STATUSES = Object.freeze(['CONFIRMED', 'WAITING', 'IN_PROGRESS', 'COMPLETED']);

/**
 * URL (relative to the API base) of a patient's photo for the doctor of `appointmentId`, or null when the
 * patient has no photo or the appointment's status does not allow access. The URL only addresses the
 * gated, audited route (GET /v1/doctors/me/patients/:patientId/photo); the server re-checks everything.
 */
export function assignedDoctorPhotoPath({ patientId, appointmentId, status, avatarUpdatedAt }) {
  if (!avatarUpdatedAt || !DOCTOR_READ_STATUSES.includes(status)) return null;
  return `/v1/doctors/me/patients/${patientId}/photo?appointmentId=${appointmentId}&v=${new Date(avatarUpdatedAt).getTime()}`;
}
