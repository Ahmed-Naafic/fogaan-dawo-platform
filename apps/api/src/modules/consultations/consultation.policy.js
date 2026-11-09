import { JOIN_EARLY_MINUTES, JOIN_LATE_MINUTES, JOINABLE_APPOINTMENT_STATUSES } from './consultation.constants.js';

/**
 * Consultation rules as pure functions (unit-tested). All times are UTC instants; the server clock
 * is the only clock used.
 */

const MIN = 60_000;

/** The join window: [start − 10 min, start + 30 min], both ends inclusive. */
export function joinWindow({ startAtUtc }) {
  const start = new Date(startAtUtc).getTime();
  return { opensAt: new Date(start - JOIN_EARLY_MINUTES * MIN), closesAt: new Date(start + JOIN_LATE_MINUTES * MIN) };
}

/**
 * Why this appointment cannot be joined right now, or null when it can.
 * `paymentStatus`: the status of the payment that covers the appointment (null when none);
 * `refunded`: a refund for that payment is requested, processing or paid out.
 * Order matters: a cancelled or unpaid appointment reports that, not its timing.
 */
export function joinBlocker({ appointment, consultation = null, paymentStatus, refunded = false, now = new Date() }) {
  if (consultation?.status === 'COMPLETED' || appointment.status === 'COMPLETED') return 'ENDED';
  if (!JOINABLE_APPOINTMENT_STATUSES.includes(appointment.status)) return 'NOT_JOINABLE';
  if (paymentStatus !== 'SUCCEEDED') return 'NOT_PAID';
  if (refunded) return 'NOT_JOINABLE';
  const { opensAt, closesAt } = joinWindow(appointment);
  if (now < opensAt) return 'TOO_EARLY';
  // A call already in progress may be reconnected after the window (it is continuing, not being joined).
  if (now > closesAt && consultation?.status !== 'IN_PROGRESS') return 'TOO_LATE';
  return null;
}

/** Join eligibility for display on appointment pages (the join endpoint re-checks everything). */
export function joinAction(appointment, { paymentStatus, refunded = false, consultation = null, now = new Date() }) {
  const blocker = joinBlocker({ appointment, consultation, paymentStatus, refunded, now });
  const { opensAt, closesAt } = joinWindow(appointment);
  return { allowed: blocker === null, blocker, opensAt: opensAt.toISOString(), closesAt: closesAt.toISOString() };
}

/** Whole seconds between start and end (never negative); null until both are known. */
export function durationSeconds(startedAt, endedAt) {
  if (!startedAt || !endedAt) return null;
  return Math.max(0, Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));
}

/**
 * Patient admission state derived from the consultation and its event log (oldest first):
 * ENDED | IN_CALL | REJECTED | WAITING | NOT_JOINED.
 */
export function admissionState(consultation, events = []) {
  if (!consultation) return 'NOT_JOINED';
  if (consultation.status === 'COMPLETED' || consultation.status === 'CANCELLED') return 'ENDED';
  if (consultation.status === 'IN_PROGRESS') return 'IN_CALL';
  const last = [...events].reverse().find((e) => ['PATIENT_JOINED', 'DOCTOR_REJECTED', 'PATIENT_LEFT'].includes(e.eventType));
  if (!last || last.eventType === 'PATIENT_LEFT') return 'NOT_JOINED';
  return last.eventType === 'DOCTOR_REJECTED' ? 'REJECTED' : 'WAITING';
}

/** Lifecycle transitions allowed for a consultation status. */
const TRANSITIONS = Object.freeze({ WAITING: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['COMPLETED'], COMPLETED: [], CANCELLED: [] });
/** True when a consultation may move from status `from` to `to` (WAITING → IN_PROGRESS/CANCELLED, IN_PROGRESS → COMPLETED). */
export const canTransition = (from, to) => (TRANSITIONS[from] ?? []).includes(to);
