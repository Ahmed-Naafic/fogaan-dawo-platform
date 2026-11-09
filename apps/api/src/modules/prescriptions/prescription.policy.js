import { NOTE_EDIT_WINDOW_HOURS } from '../consultations/consultation.constants.js';

/**
 * Prescription rules (pure, unit-tested). Lifecycle:
 *
 *   DRAFT ─issue→ VALID ─cancel (reason)→ CANCELLED
 *                       └replace (reason)→ REPLACED  (+ a new prescription that replaces it)
 *
 * Issuing window (server clock, UTC): while the consultation is IN_PROGRESS, or within 24 hours after it
 * completed (the same window as consultation notes). Replacement issues a new prescription, so it follows
 * the same window. Cancellation of an issued prescription is allowed at any time, with a reason.
 */
export const ISSUE_WINDOW_HOURS = NOTE_EDIT_WINDOW_HOURS;
export const MAX_ITEMS = 10;

export const PrescriptionErrorCode = Object.freeze({
  notFound: 'PRESCRIPTION_NOT_FOUND',
  forbidden: 'PRESCRIPTION_FORBIDDEN',
  doctorInactive: 'DOCTOR_NOT_ACTIVE',
  windowClosed: 'PRESCRIPTION_WINDOW_CLOSED',
  notDraft: 'PRESCRIPTION_NOT_DRAFT',
  notValid: 'PRESCRIPTION_NOT_VALID',
  alreadyReplaced: 'PRESCRIPTION_ALREADY_REPLACED',
  pdfUnavailable: 'PRESCRIPTION_PDF_UNAVAILABLE',
  pdfIntegrity: 'PRESCRIPTION_PDF_INTEGRITY',
});

const TRANSITIONS = Object.freeze({
  DRAFT: ['VALID'],
  VALID: ['CANCELLED', 'REPLACED'],
  CANCELLED: [],
  REPLACED: [],
});

/** True when a prescription may move from `from` to `to` (DRAFT → VALID, VALID → CANCELLED/REPLACED). */
export const canTransition = (from, to) => (TRANSITIONS[from] ?? []).includes(to);

/** { open, reason, closesAt } for issuing on `consultation` at `now`. */
export function issueWindow(consultation, now = new Date()) {
  if (!consultation) return { open: false, reason: 'NO_CONSULTATION', closesAt: null };
  if (consultation.status === 'IN_PROGRESS') return { open: true, reason: null, closesAt: null };
  if (consultation.status === 'COMPLETED' && consultation.completedAt) {
    const closesAt = new Date(new Date(consultation.completedAt).getTime() + ISSUE_WINDOW_HOURS * 3_600_000);
    return now < closesAt ? { open: true, reason: null, closesAt } : { open: false, reason: 'WINDOW_PASSED', closesAt };
  }
  return { open: false, reason: consultation.status === 'CANCELLED' ? 'CONSULTATION_CANCELLED' : 'CONSULTATION_NOT_STARTED', closesAt: null };
}

/** FD-RX-2026-000123 (year of issue, UTC; number from a database sequence). */
export const formatReference = (issuedAt, n) => `FD-RX-${new Date(issuedAt).getUTCFullYear()}-${String(n).padStart(6, '0')}`;
