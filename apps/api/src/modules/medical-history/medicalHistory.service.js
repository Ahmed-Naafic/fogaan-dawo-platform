import { getPrivateObject } from '../../adapters/storage/privateStorage.js';
import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';
import * as consultationRepository from '../consultations/consultation.repository.js';
import * as doctorRepository from '../doctors/doctor.repository.js';
import * as patientRepository from '../patients/patient.repository.js';
import * as medicalHistoryRepository from './medicalHistory.repository.js';
import { assignedDoctorPhotoPath, DOCTOR_READ_STATUSES } from './medicalHistory.constants.js';

/**
 * Longitudinal medical history — separate from consultation records (notes, prescriptions), which keep
 * their own rules (e.g. the 24-hour note lock).
 *
 * Ownership (approved Phase 9 rules):
 * - The patient may add entries, edit entries THEY wrote, and archive any entry in their history
 *   (including doctor-written ones). They can never edit a doctor-written entry.
 * - A doctor may add entries for a patient they have consulted and edit/archive only entries they
 *   authored; never patient-written entries or another doctor's.
 * - Authorship (created_by_user_id, source), the linked consultation and creation time never change
 *   (also enforced by a database trigger). Every edit records updated_by_user_id.
 * - Entries are never deleted; archiving freezes an entry (no further edits, never un-archived).
 * - Audit entries record which fields changed, never the medical content itself.
 */
export const EDITABLE_FIELDS = Object.freeze(['entryType', 'title', 'description', 'recordedAt']);

export const HistoryErrorCode = Object.freeze({
  notPatient: 'PATIENT_PROFILE_REQUIRED',
  entryArchived: 'HISTORY_ENTRY_ARCHIVED',
  doctorEntryReadOnly: 'HISTORY_DOCTOR_ENTRY_READ_ONLY',
});

async function resolveActor(tx, actorUserId, patientId) {
  const patient = await patientRepository.findPatientById(tx, patientId);
  if (!patient) throw ApiError.notFound('Patient not found');
  if (patient.userId === actorUserId) return { kind: 'PATIENT' };
  const doctor = await doctorRepository.findDoctorByUserId(tx, actorUserId);
  if (doctor && (await consultationRepository.countConsultationsBetween(tx, { doctorId: doctor.id, patientId })) > 0) return { kind: 'DOCTOR', doctor };
  return null;
}

function pickEditable(changes) {
  const unknown = Object.keys(changes).filter((k) => !EDITABLE_FIELDS.includes(k));
  if (unknown.length) throw ApiError.badRequest(`These fields cannot be changed: ${unknown.join(', ')}`);
  return changes;
}

/**
 * Pure permission rule (unit-tested). `actor` is { kind: 'PATIENT' | 'DOCTOR', userId } for someone
 * already proven to be the patient or a consulting doctor; returns { canEdit, canArchive }.
 */
export function entryPermissions(entry, actor) {
  if (!actor || entry.archivedAt) return { canEdit: false, canArchive: false };
  const authoredByActor = entry.createdByUserId === actor.userId;
  if (actor.kind === 'PATIENT') return { canEdit: authoredByActor && entry.source === 'PATIENT', canArchive: true };
  if (actor.kind === 'DOCTOR') return { canEdit: authoredByActor && entry.source === 'DOCTOR', canArchive: authoredByActor && entry.source === 'DOCTOR' };
  return { canEdit: false, canArchive: false };
}

/** Response shape of a medical-history entry with source, author and the viewer's edit/archive rights. */
export function presentEntry(entry, actor) {
  return {
    id: entry.id,
    entryType: entry.entryType,
    title: entry.title,
    description: entry.description ?? null,
    recordedAt: entry.recordedAt?.toISOString() ?? null,
    source: entry.source,
    // Doctor-written entries are labelled with the doctor's name; the patient's own entries need no name.
    authorName: entry.source === 'DOCTOR' ? (entry.author?.fullName ?? null) : null,
    fromConsultation: Boolean(entry.consultationId),
    archivedAt: entry.archivedAt?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    ...entryPermissions(entry, actor),
  };
}

const changedFields = (changes) => Object.keys(changes).sort();

/** Adds a medical-history entry as the patient or an assigned doctor (inside an eligible appointment). Audited. */
export async function addEntry({ actorUserId, patientId, consultationId = null, ...fields }) {
  return withTransaction(async (tx) => {
    const actor = await resolveActor(tx, actorUserId, patientId);
    if (!actor) throw ApiError.forbidden('Only the patient or a doctor who consulted them can add history entries');
    if (consultationId) {
      const consultation = await consultationRepository.findConsultationById(tx, consultationId);
      if (!consultation || consultation.patientId !== patientId || (actor.kind === 'DOCTOR' && consultation.doctorId !== actor.doctor.id)) {
        throw ApiError.badRequest('Consultation does not belong to this patient/doctor');
      }
    }
    const history = await medicalHistoryRepository.ensureMedicalHistory(tx, patientId);
    const entry = await medicalHistoryRepository.createEntry(tx, {
      medicalHistoryId: history.id,
      ...pickEditable(fields),
      source: actor.kind,
      createdByUserId: actorUserId,
      updatedByUserId: actorUserId,
      consultationId,
    });
    await auditRepository.createAuditLog(tx, { actorUserId, action: 'CREATE', entityType: 'MedicalHistoryEntry', entityId: entry.id, newValues: { patientId, entryType: entry.entryType, source: actor.kind } });
    return entry;
  });
}

async function loadForChange(tx, actorUserId, entryId, ownPatientIdOnly = null) {
  if (!(await lockRow(tx, 'medical_history_entries', entryId))) throw ApiError.notFound('Medical history entry not found');
  const entry = await medicalHistoryRepository.findEntryWithHistory(tx, entryId);
  // The patient's own endpoints only ever address that patient's history.
  if (ownPatientIdOnly && entry.history.patientId !== ownPatientIdOnly) throw ApiError.notFound('Medical history entry not found');
  const actor = await resolveActor(tx, actorUserId, entry.history.patientId);
  if (!actor) throw ApiError.notFound('Medical history entry not found'); // no existence leak to strangers
  if (entry.archivedAt) throw ApiError.conflict('This entry is archived and can no longer be changed', undefined, HistoryErrorCode.entryArchived);
  return { entry, actor, rules: entryPermissions(entry, { kind: actor.kind, userId: actorUserId }) };
}

/** Edits an entry; only its author (or the patient for their own entries) may, and archived entries are frozen. */
export async function updateEntry({ actorUserId, entryId, changes, ownPatientIdOnly = null }) {
  return withTransaction(async (tx) => {
    const { entry, actor, rules } = await loadForChange(tx, actorUserId, entryId, ownPatientIdOnly);
    const picked = pickEditable(changes);
    if (!rules.canEdit) {
      if (actor.kind === 'PATIENT' && entry.source !== 'PATIENT') {
        throw ApiError.forbidden('Entries written by a doctor cannot be edited; you can archive them', undefined, HistoryErrorCode.doctorEntryReadOnly);
      }
      throw ApiError.forbidden('You cannot edit this medical history entry');
    }
    const updated = await medicalHistoryRepository.updateEntry(tx, entryId, { ...picked, updatedByUserId: actorUserId });
    await auditRepository.createAuditLog(tx, { actorUserId, action: 'UPDATE', entityType: 'MedicalHistoryEntry', entityId: entryId, newValues: { fields: changedFields(picked) } });
    return updated;
  });
}

/** Archives an entry (never deleted); the patient may archive any entry of their own history. */
export async function archiveEntry({ actorUserId, entryId, ownPatientIdOnly = null, now = new Date() }) {
  return withTransaction(async (tx) => {
    const { entry, rules } = await loadForChange(tx, actorUserId, entryId, ownPatientIdOnly);
    if (!rules.canArchive) throw ApiError.forbidden('You cannot archive this medical history entry');
    const updated = await medicalHistoryRepository.updateEntry(tx, entryId, { archivedAt: now, archivedByUserId: actorUserId, updatedByUserId: actorUserId });
    await auditRepository.createAuditLog(tx, { actorUserId, action: 'UPDATE', entityType: 'MedicalHistoryEntry', entityId: entryId, newValues: { archived: true, source: entry.source } });
    return updated;
  });
}

/* ------------------------------------------------- the patient's own history (API) */

function ownPatientId(auth) {
  const patientId = auth.user.patientProfile?.id;
  if (!patientId) throw ApiError.forbidden('A patient profile is required', undefined, HistoryErrorCode.notPatient);
  return patientId;
}

const patientActor = (auth) => ({ kind: 'PATIENT', userId: auth.user.id });

/** GET /api/v1/me/medical-history: the patient's own history (archived entries optional). */
export async function listMyHistory(auth, { includeArchived = false } = {}) {
  const entries = await medicalHistoryRepository.listEntriesForPatient(prisma, ownPatientId(auth), { includeArchived });
  return { entries: entries.map((e) => presentEntry(e, patientActor(auth))) };
}

/** POST /api/v1/me/medical-history: the patient adds an entry to their own history. */
export async function addMyEntry(auth, fields) {
  const entry = await addEntry({ actorUserId: auth.user.id, patientId: ownPatientId(auth), ...fields });
  return presentEntry(entry, patientActor(auth));
}

/** PATCH /api/v1/me/medical-history/entries/:id: the patient edits one of their own entries. */
export async function updateMyEntry(auth, entryId, changes) {
  const patientId = ownPatientId(auth);
  return presentEntry(await updateEntry({ actorUserId: auth.user.id, entryId, changes, ownPatientIdOnly: patientId }), patientActor(auth));
}

/** POST /api/v1/me/medical-history/entries/:id/archive: the patient archives an entry. */
export async function archiveMyEntry(auth, entryId) {
  const patientId = ownPatientId(auth);
  return presentEntry(await archiveEntry({ actorUserId: auth.user.id, entryId, ownPatientIdOnly: patientId }), patientActor(auth));
}

/* ------------------------------------------- assigned doctor: read-only patient information */

export { DOCTOR_READ_STATUSES };

export const PatientAccessErrorCode = Object.freeze({
  denied: 'PATIENT_ACCESS_DENIED',
  doctorInactive: 'DOCTOR_NOT_ACTIVE',
});

/** Whole years between date of birth and `now` (UTC calendar), or null. */
export function ageOn(dateOfBirth, now = new Date()) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday = now.getUTCMonth() < dob.getUTCMonth() || (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

/** The emergency contact is clinical-workflow data only while the consultation is actually running. */
export const isActiveConsultation = (appointment) => appointment.status === 'IN_PROGRESS' || appointment.consultation?.status === 'IN_PROGRESS';

/**
 * Restricted summary for the assigned doctor. Only: name (already on the appointment), age, sex, the
 * profile photo (through the doctor's own gated, audited photo route; never a storage key), and the
 * emergency contact during an active consultation. Never address, email, phone or account data.
 */
export function presentPatientSummary(patient, { active, appointmentId, now = new Date() }) {
  const hasContact = Boolean(patient.emergencyName || patient.emergencyPhone);
  return {
    id: patient.id,
    name: patient.user.fullName,
    age: ageOn(patient.dateOfBirth, now),
    sex: patient.sex ?? null,
    // Only reached for an eligible appointment, so the status check inside the helper always passes here.
    photoUrl: assignedDoctorPhotoPath({ patientId: patient.id, appointmentId, status: 'CONFIRMED', avatarUpdatedAt: patient.user.avatarUpdatedAt }),
    emergencyContact: active && hasContact ? { name: patient.emergencyName ?? '', relationship: patient.emergencyRelationship ?? '', phone: patient.emergencyPhone ?? '' } : null,
  };
}

/**
 * The single authorization rule for every assigned-doctor read: the signed-in doctor is verified and
 * active AND `appointmentId` is that doctor's own appointment with that patient in DOCTOR_READ_STATUSES.
 * Every denial is the same 403, so nothing leaks about other patients.
 */
async function authorizeAssignedDoctor(auth, { patientId, appointmentId }) {
  const doctor = await doctorRepository.findDoctorByUserId(prisma, auth.user.id);
  if (!doctor) throw ApiError.forbidden('Not allowed', undefined, PatientAccessErrorCode.denied);
  if (doctor.verificationStatus !== 'VERIFIED' || doctor.accountStatus !== 'ACTIVE') {
    throw ApiError.forbidden('Your doctor account is not active', undefined, PatientAccessErrorCode.doctorInactive);
  }
  const appointment = await medicalHistoryRepository.findEligibleAppointment(prisma, { appointmentId, doctorId: doctor.id, patientId, statuses: DOCTOR_READ_STATUSES });
  if (!appointment) throw ApiError.forbidden('You can only view patients from your own eligible appointments', undefined, PatientAccessErrorCode.denied);
  return { doctor, appointment };
}

/** The patient's profile photo for the assigned doctor (same rule as the history). Audited. */
export async function getPatientPhotoForDoctor(auth, { patientId, appointmentId }) {
  const { doctor, appointment } = await authorizeAssignedDoctor(auth, { patientId, appointmentId });
  const row = await medicalHistoryRepository.findPatientAvatar(prisma, patientId);
  if (!row?.user.avatarKey) throw ApiError.notFound('Photo not found');
  let buffer;
  try {
    buffer = await getPrivateObject(row.user.avatarKey);
  } catch {
    throw ApiError.notFound('Photo not found');
  }
  await auditRepository.createAuditLog(prisma, {
    actorUserId: auth.user.id,
    action: 'OTHER',
    entityType: 'PatientMedicalHistoryAccess',
    entityId: patientId,
    newValues: { action: 'VIEW_PATIENT_PHOTO', doctorId: doctor.id, patientId, appointmentId: appointment.id, consultationId: appointment.consultation?.id ?? null, appointmentStatus: appointment.status },
  });
  return { buffer, mimeType: 'image/jpeg' };
}

/**
 * GET /api/v1/doctors/me/patients/:patientId/medical-history?appointmentId=…
 * Authorised only when the signed-in doctor is verified + active AND `appointmentId` is that doctor's own
 * appointment with that patient in DOCTOR_READ_STATUSES. Knowing a patient id alone grants nothing; every
 * denial looks the same (403 PATIENT_ACCESS_DENIED), so nothing leaks about other patients.
 * Read-only for patient-written entries; the doctor's own entries carry canEdit (existing service rules).
 * Every successful read is audited (doctor, patient, appointment/consultation, time, action) without content.
 */
export async function getPatientInformationForDoctor(auth, { patientId, appointmentId }, now = new Date()) {
  const { doctor, appointment } = await authorizeAssignedDoctor(auth, { patientId, appointmentId });
  const patient = await medicalHistoryRepository.findPatientClinicalSummary(prisma, patientId);
  if (!patient) throw ApiError.forbidden('Not allowed', undefined, PatientAccessErrorCode.denied);

  const entries = await medicalHistoryRepository.listEntriesForPatient(prisma, patientId, { includeArchived: false });
  const actor = { kind: 'DOCTOR', userId: auth.user.id };
  const active = isActiveConsultation(appointment);
  await auditRepository.createAuditLog(prisma, {
    actorUserId: auth.user.id,
    action: 'OTHER',
    entityType: 'PatientMedicalHistoryAccess',
    entityId: patientId,
    newValues: {
      action: 'VIEW_MEDICAL_HISTORY',
      doctorId: doctor.id,
      patientId,
      appointmentId: appointment.id,
      consultationId: appointment.consultation?.id ?? null,
      appointmentStatus: appointment.status,
      emergencyContactShown: active,
      entryCount: entries.length,
    },
  });
  return {
    appointment: { id: appointment.id, status: appointment.status, activeConsultation: active },
    patient: presentPatientSummary(patient, { active, appointmentId: appointment.id, now }),
    entries: entries.map((e) => {
      const presented = presentEntry(e, actor);
      // Doctors never archive here and never act on patient-written entries.
      return { ...presented, canArchive: false, canEdit: presented.canEdit && e.source === 'DOCTOR' };
    }),
  };
}
