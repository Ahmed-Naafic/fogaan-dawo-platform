import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Consultation summary — a consultation record, separate from the longitudinal medical history (nothing
 * is copied there). The patient sees ONLY the note sections the doctor shared (share_* switches) plus the
 * prescriptions issued in that consultation; the assigned doctor sees every section with its share state.
 * The 24-hour note lock is unchanged (notes are edited only through consultation.service.saveNote).
 */
export const SUMMARY_SECTIONS = Object.freeze([
  ['complaint', 'shareComplaint'],
  ['assessment', 'shareAssessment'],
  ['diagnosis', 'shareDiagnosis'],
  ['advice', 'shareAdvice'],
]);

/** Pure: the sections a patient may see (shared AND non-empty). */
export function sharedSections(note) {
  if (!note) return [];
  return SUMMARY_SECTIONS.filter(([field, flag]) => note[flag] === true && typeof note[field] === 'string' && note[field].trim()).map(([field]) => ({ key: field, text: note[field] }));
}

/** Pure: every section for the doctor, with its share state. */
export const doctorSections = (note) =>
  SUMMARY_SECTIONS.map(([field, flag]) => ({ key: field, text: note?.[field] ?? null, shared: Boolean(note?.[flag]) }));

/** GET /api/v1/consultations/:id/summary: the patient sees advice and shared sections; the doctor sees all sections and the lock time. */
export async function getConsultationSummary(auth, consultationId) {
  const c = await prisma.consultation.findUnique({
    where: { id: consultationId },
    select: {
      id: true,
      status: true,
      startedAt: true,
      completedAt: true,
      durationSeconds: true,
      appointmentId: true,
      appointment: { select: { startAtUtc: true } },
      note: true,
      patient: { select: { userId: true, user: { select: { fullName: true } } } },
      doctor: { select: { userId: true, specialty: { select: { nameEn: true, nameSo: true } }, user: { select: { fullName: true } } } },
      prescriptions: {
        where: { status: { not: 'DRAFT' } },
        orderBy: { issuedAt: 'asc' },
        select: { id: true, reference: true, status: true, issuedAt: true, _count: { select: { items: true } } },
      },
      _count: { select: { attachments: { where: { archivedAt: null } } } },
    },
  });
  const isDoctor = Boolean(c) && auth.activeRole === 'DOCTOR' && c.doctor.userId === auth.user.id;
  const isPatient = Boolean(c) && auth.activeRole === 'PATIENT' && c.patient.userId === auth.user.id;
  if (!isDoctor && !isPatient) throw ApiError.notFound('Consultation not found'); // no existence leak

  const completed = c.status === 'COMPLETED';
  return {
    consultationId: c.id,
    appointmentId: c.appointmentId,
    status: c.status,
    available: completed,
    scheduledAt: c.appointment.startAtUtc.toISOString(),
    startedAt: c.startedAt?.toISOString() ?? null,
    completedAt: c.completedAt?.toISOString() ?? null,
    durationSeconds: c.durationSeconds ?? null,
    doctor: { name: c.doctor.user.fullName, specialty: c.doctor.specialty },
    patient: { name: c.patient.user.fullName },
    sections: isDoctor ? doctorSections(c.note) : completed ? sharedSections(c.note) : [],
    notesLockedAt: isDoctor ? (c.note?.lockedAt?.toISOString() ?? null) : undefined,
    prescriptions: c.prescriptions.map((p) => ({ id: p.id, reference: p.reference, status: p.status, issuedAt: p.issuedAt?.toISOString() ?? null, itemCount: p._count.items })),
    documentCount: c._count.attachments,
  };
}

/**
 * The signed-in patient's consultation summaries (list view): one row per completed consultation with how
 * many sections the doctor shared and how many prescriptions were issued. No note text here — the detail
 * comes from getConsultationSummary, which applies the share switches.
 */
export async function listMySummaries(auth) {
  const patientId = auth.user.patientProfile?.id;
  if (!patientId) throw ApiError.forbidden('A patient profile is required');
  const rows = await prisma.consultation.findMany({
    where: { patientId, status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
    take: 200,
    select: {
      id: true,
      appointmentId: true,
      completedAt: true,
      note: { select: { complaint: true, assessment: true, diagnosis: true, advice: true, shareComplaint: true, shareAssessment: true, shareDiagnosis: true, shareAdvice: true } },
      doctor: { select: { specialty: { select: { nameEn: true, nameSo: true } }, user: { select: { fullName: true } } } },
      _count: { select: { prescriptions: { where: { status: { not: 'DRAFT' } } }, attachments: { where: { archivedAt: null } } } },
    },
  });
  return {
    items: rows.map((c) => ({
      consultationId: c.id,
      appointmentId: c.appointmentId,
      completedAt: c.completedAt?.toISOString() ?? null,
      doctor: { name: c.doctor.user.fullName, specialty: c.doctor.specialty },
      sharedSectionCount: sharedSections(c.note).length,
      prescriptionCount: c._count.prescriptions,
      documentCount: c._count.attachments,
    })),
  };
}
