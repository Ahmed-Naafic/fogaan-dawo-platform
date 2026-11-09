import { ApiError } from '../../utils/ApiError.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import { NOTE_EDIT_WINDOW_HOURS, NOTE_FIELDS } from './consultation.constants.js';
import { durationSeconds } from './consultation.policy.js';
import * as consultationRepository from './consultation.repository.js';
import * as notificationEvents from '../notifications/notification.events.js';

const sharesAnything = (note) => Boolean(note && (note.shareComplaint || note.shareAssessment || note.shareDiagnosis || note.shareAdvice));

/** The patient learns once per consultation that a summary exists (completed + something shared). */
async function announceSummary(tx, consultation, note) {
  if (consultation.status === 'COMPLETED' && sharesAnything(note)) {
    await notificationEvents.consultationSummaryAvailable(tx, { consultationId: consultation.id, appointmentId: consultation.appointmentId });
  }
}

const lockTimeFor = (completedAt) => new Date(completedAt.getTime() + NOTE_EDIT_WINDOW_HOURS * 3_600_000);

async function requireConsultationDoctor(tx, consultationId, actorUserId) {
  if (!(await lockRow(tx, 'consultations', consultationId))) throw ApiError.notFound('Consultation not found');
  const consultation = await consultationRepository.findConsultationWithDoctor(tx, consultationId);
  if (consultation.doctor.userId !== actorUserId) throw ApiError.forbidden('Only the consulting doctor can do this');
  return consultation;
}

/** True when at least one note section (complaint, assessment, diagnosis, advice) has text. */
export const hasNoteText = (note) => ['complaint', 'assessment', 'diagnosis', 'advice'].some((f) => typeof note?.[f] === 'string' && note[f].trim().length > 0);

/**
 * Completes an already-locked consultation inside the caller's transaction: COMPLETED, endedAt,
 * completedAt, the server-measured duration, and the note lock time (completed_at + 24 h).
 */
export async function completeLockedConsultation(tx, consultation, { now = new Date(), endedBy = null } = {}) {
  // Requirement: a consultation cannot be marked Completed without notes.
  if (!hasNoteText(await consultationRepository.findNoteByConsultationId(tx, consultation.id))) {
    throw ApiError.conflict('Write the consultation notes before completing the consultation', undefined, 'CONSULTATION_NOTES_REQUIRED');
  }
  const endedAt = consultation.endedAt ?? now;
  const updated = await consultationRepository.updateConsultation(tx, consultation.id, {
    status: 'COMPLETED',
    endedAt,
    completedAt: now,
    durationSeconds: durationSeconds(consultation.startedAt, endedAt),
    ...(endedBy ? { endedBy } : {}),
  });
  const note = await consultationRepository.upsertNote(tx, consultation.id, { create: { lockedAt: lockTimeFor(now) }, update: { lockedAt: lockTimeFor(now) } });
  await announceSummary(tx, updated, note);
  return updated;
}

/** Completes a consultation and fixes the note lock time (completed_at + 24 h). */
export async function completeConsultation({ consultationId, actorUserId, now = new Date() }) {
  return withTransaction(async (tx) => {
    const consultation = await requireConsultationDoctor(tx, consultationId, actorUserId);
    if (consultation.status === 'COMPLETED') throw ApiError.conflict('Consultation is already completed');
    return completeLockedConsultation(tx, consultation, { now });
  });
}

/** Creates or updates the consultation note; refused once the 24-hour window has passed. */
export async function saveNote({ consultationId, actorUserId, fields, now = new Date() }) {
  const unknown = Object.keys(fields).filter((k) => !NOTE_FIELDS.includes(k));
  if (unknown.length) throw ApiError.badRequest(`Unknown note fields: ${unknown.join(', ')}`);

  return withTransaction(async (tx) => {
    const consultation = await requireConsultationDoctor(tx, consultationId, actorUserId);
    const note = await consultationRepository.findNoteByConsultationId(tx, consultationId);
    const lockAt = note?.lockedAt ?? (consultation.completedAt ? lockTimeFor(consultation.completedAt) : null);
    if (lockAt && now >= lockAt) throw ApiError.locked('Consultation notes are locked 24 hours after the consultation', { lockedAt: lockAt });
    const saved = await consultationRepository.upsertNote(tx, consultationId, { create: { ...fields, lockedAt: lockAt }, update: fields });
    await announceSummary(tx, consultation, saved);
    return saved;
  });
}
