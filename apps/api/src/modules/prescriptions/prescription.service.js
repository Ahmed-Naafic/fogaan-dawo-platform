import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getPrivateObject, putPrivateObject, removePrivateObject } from '../../adapters/storage/privateStorage.js';
import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';
import * as doctorRepository from '../doctors/doctor.repository.js';
import * as notificationEvents from '../notifications/notification.events.js';
import { canTransition, formatReference, issueWindow, PrescriptionErrorCode as Code } from './prescription.policy.js';
import { renderPrescriptionPdf } from './prescription.pdf.js';
import * as prescriptionRepository from './prescription.repository.js';

/** QR tokens are random; only their SHA-256 hash is stored (verification_token_hash). */
export const hashVerificationToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex');
export const newVerificationToken = () => randomBytes(32).toString('base64url');
export const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/** Where the QR code points: the public verification page of the web app (never a PDF or record). */
export const verificationUrl = (token) => `${String(process.env.WEB_APP_URL || 'http://localhost:5173').replace(/\/+$/, '')}/verify/${token}`;

/**
 * Public QR verification. Returns only whether the prescription is genuine and valid, its status, when it
 * was issued, and who issued it. Never patient identity, medicines or any clinical content. Drafts have no
 * token, so they can never be found.
 */
export async function verifyPrescriptionToken(token, client = prisma) {
  if (typeof token !== 'string' || token.length < 16 || token.length > 200) return { valid: false };
  const prescription = await prescriptionRepository.findForPublicVerification(client, hashVerificationToken(token));
  if (!prescription || prescription.status === 'DRAFT') return { valid: false };
  return {
    valid: prescription.status === 'VALID',
    status: prescription.status,
    issuedAt: prescription.issuedAt,
    cancelledAt: prescription.cancelledAt,
    issuedBy: { name: prescription.doctor.user.fullName, specialty: prescription.doctor.specialty },
  };
}

/* ------------------------------------------------------------------ helpers */

const notFound = () => new ApiError(404, 'Prescription not found', undefined, Code.notFound);
const ELIGIBLE_APPOINTMENT_STATUSES = ['WAITING', 'IN_PROGRESS', 'COMPLETED'];

/** The signed-in doctor, required to be verified and active (re-checked inside every write transaction). */
async function activeDoctor(client, auth) {
  const doctor = await doctorRepository.findDoctorByUserId(client, auth.user.id);
  if (!doctor) throw ApiError.forbidden('Only doctors can prescribe', undefined, Code.forbidden);
  if (doctor.verificationStatus !== 'VERIFIED' || doctor.accountStatus !== 'ACTIVE') {
    throw ApiError.forbidden('Your doctor account is not active', undefined, Code.doctorInactive);
  }
  return doctor;
}

/**
 * The consultation, only if `doctor` is its assigned doctor and the appointment is eligible. Unrelated
 * doctors get the same 404 as a missing consultation (no existence leak).
 */
async function assignedConsultation(client, doctor, consultationId) {
  const c = await prescriptionRepository.findConsultationForPrescribing(client, consultationId);
  if (!c || c.doctorId !== doctor.id) throw ApiError.notFound('Consultation not found');
  if (!ELIGIBLE_APPOINTMENT_STATUSES.includes(c.appointment.status)) {
    throw ApiError.conflict('Prescriptions can only be written for a consultation that took place', { status: c.appointment.status }, Code.windowClosed);
  }
  return c;
}

function assertWindowOpen(consultation, now) {
  const w = issueWindow(consultation, now);
  if (!w.open) throw ApiError.conflict('Prescriptions can be issued during the consultation or within 24 hours after it', { reason: w.reason, closesAt: w.closesAt }, Code.windowClosed);
  return w;
}

async function lockedPrescription(tx, id) {
  if (!(await lockRow(tx, 'prescriptions', id))) throw notFound();
  return prescriptionRepository.findPrescriptionRow(tx, id);
}

const itemFields = (it) => ({
  medicineName: it.medicineName,
  dose: it.dose,
  frequency: it.frequency,
  duration: it.duration,
  quantity: it.quantity ?? null,
  instructions: it.instructions ?? null,
  warnings: it.warnings ?? null,
});

/* ------------------------------------------------------------------ presenter */

/**
 * Client view. The patient never sees drafts (filtered before this). Storage keys, token hashes and
 * checksums are never returned; the PDF is only reachable through the authorised download route.
 */
export function presentPrescription(rx, { viewer, now = new Date(), window = null }) {
  const isDoctor = viewer === 'DOCTOR';
  const open = Boolean(window?.open);
  return {
    id: rx.id,
    reference: rx.reference,
    status: rx.status,
    issuedAt: rx.issuedAt?.toISOString() ?? null,
    cancelledAt: rx.cancelledAt?.toISOString() ?? null,
    cancellationReason: rx.cancellationReason ?? null,
    replacedAt: rx.replacedAt?.toISOString() ?? null,
    replacementReason: rx.replacementReason ?? null,
    replaces: rx.replaces ? { id: rx.replaces.id, reference: rx.replaces.reference } : null,
    replacedBy: rx.replacedBy ? { id: rx.replacedBy.id, reference: rx.replacedBy.reference } : null,
    generalNotes: rx.generalNotes ?? null,
    consultationId: rx.consultationId,
    appointmentId: rx.consultation?.appointmentId ?? null,
    doctor: { name: rx.doctor.user.fullName, specialty: rx.doctor.specialty },
    patient: { name: rx.patient.user.fullName },
    items: rx.items.map(({ id, medicineName, dose, frequency, duration, quantity, instructions, warnings }) => ({ id, medicineName, dose, frequency, duration, quantity, instructions, warnings })),
    hasPdf: Boolean(rx.pdfFileKey),
    createdAt: rx.createdAt?.toISOString() ?? null,
    ...(isDoctor
      ? {
          window: window ? { open, closesAt: window.closesAt?.toISOString?.() ?? null, reason: window.reason } : null,
          actions: {
            edit: rx.status === 'DRAFT' && open,
            issue: rx.status === 'DRAFT' && open,
            discard: rx.status === 'DRAFT',
            replace: rx.status === 'VALID' && !rx.replacedBy && open,
            cancel: rx.status === 'VALID',
          },
        }
      : {}),
  };
}

async function doctorView(client, id, now) {
  const rx = await prescriptionRepository.findPrescriptionDetail(client, id);
  const consultation = await prescriptionRepository.findConsultationForPrescribing(client, rx.consultationId);
  return presentPrescription(rx, { viewer: 'DOCTOR', now, window: issueWindow(consultation, now) });
}

/* ------------------------------------------------------------------ drafts */

export async function createDraft(auth, consultationId, input, now = new Date()) {
  const id = await withTransaction(async (tx) => {
    const doctor = await activeDoctor(tx, auth);
    await lockRow(tx, 'consultations', consultationId);
    const c = await assignedConsultation(tx, doctor, consultationId);
    assertWindowOpen(c, now);
    const { id: rxId } = await prescriptionRepository.createDraft(tx, { consultationId, patientId: c.patientId, doctorId: doctor.id, generalNotes: input.generalNotes, items: input.items.map(itemFields) });
    await auditRepository.createAuditLog(tx, { actorUserId: auth.user.id, action: 'CREATE', entityType: 'Prescription', entityId: rxId, newValues: { status: 'DRAFT', consultationId, itemCount: input.items.length } });
    return rxId;
  });
  return doctorView(prisma, id, now);
}

async function ownDraft(tx, auth, id, now) {
  const doctor = await activeDoctor(tx, auth);
  const rx = await lockedPrescription(tx, id);
  if (!rx || rx.doctorId !== doctor.id) throw notFound();
  if (rx.status !== 'DRAFT') throw ApiError.conflict('Only a draft can be changed; issued prescriptions are immutable', { status: rx.status }, Code.notDraft);
  const c = await assignedConsultation(tx, doctor, rx.consultationId);
  return { doctor, rx, c, window: issueWindow(c, now) };
}

export async function updateDraft(auth, id, input, now = new Date()) {
  await withTransaction(async (tx) => {
    const { c } = await ownDraft(tx, auth, id, now);
    assertWindowOpen(c, now);
    if ('generalNotes' in input) await prescriptionRepository.updatePrescription(tx, id, { generalNotes: input.generalNotes ?? null });
    if (input.items) await prescriptionRepository.replaceDraftItems(tx, id, input.items.map(itemFields));
    await auditRepository.createAuditLog(tx, { actorUserId: auth.user.id, action: 'UPDATE', entityType: 'Prescription', entityId: id, newValues: { status: 'DRAFT', fields: Object.keys(input).sort(), ...(input.items ? { itemCount: input.items.length } : {}) } });
  });
  return doctorView(prisma, id, now);
}

export async function discardDraft(auth, id, now = new Date()) {
  await withTransaction(async (tx) => {
    await ownDraft(tx, auth, id, now);
    await prescriptionRepository.deleteDraft(tx, id);
    await auditRepository.createAuditLog(tx, { actorUserId: auth.user.id, action: 'DELETE', entityType: 'Prescription', entityId: id, oldValues: { status: 'DRAFT' } });
  });
  return { discarded: true };
}

/* ------------------------------------------------------------------ issue / replace / cancel */

/**
 * Issues a locked DRAFT inside the caller's transaction: token (hash stored), reference, PDF rendered from
 * the saved record and stored privately with its SHA-256, VALID. `stored` collects written keys so the
 * caller can remove them if the transaction rolls back.
 */
async function issueLocked(tx, { id, actorUserId, now, stored }) {
  const rx = await prescriptionRepository.findPrescriptionDetail(tx, id);
  if (!rx.items.length) throw ApiError.badRequest('Add at least one medicine before issuing');
  if (!canTransition(rx.status, 'VALID')) throw ApiError.conflict('Only a draft can be issued', { status: rx.status }, Code.notDraft);
  const token = newVerificationToken();
  const reference = formatReference(now, await prescriptionRepository.nextReferenceNumber(tx));
  const pdf = await renderPrescriptionPdf({ ...rx, reference, issuedAt: now }, { lang: rx.patient.user.preferredLanguage === 'so' ? 'so' : 'en', verifyUrl: verificationUrl(token) });
  const pdfFileKey = `prescriptions/${id}/${randomUUID()}.pdf`;
  await putPrivateObject(pdfFileKey, pdf);
  stored.push(pdfFileKey);
  await prescriptionRepository.updatePrescription(tx, id, {
    status: 'VALID',
    verificationTokenHash: hashVerificationToken(token),
    issuedAt: now,
    reference,
    pdfFileKey,
    pdfSha256: sha256(pdf),
    pdfGeneratedAt: now,
    statusChangedByUserId: actorUserId,
  });
  await auditRepository.createAuditLog(tx, {
    actorUserId,
    action: 'CREATE',
    entityType: 'Prescription',
    entityId: id,
    oldValues: { status: 'DRAFT' },
    newValues: { status: 'VALID', action: 'ISSUED', reference, itemCount: rx.items.length, consultationId: rx.consultationId, replaces: rx.replacesPrescriptionId ?? null, pdfBytes: pdf.length },
  });
  return { rx, reference };
}

async function inTransactionWithFiles(fn) {
  const stored = [];
  try {
    return await withTransaction((tx) => fn(tx, stored), { timeout: 45_000 });
  } catch (error) {
    await Promise.all(stored.map((k) => removePrivateObject(k).catch(() => {})));
    throw error;
  }
}

export async function issueDraft(auth, id, now = new Date()) {
  await inTransactionWithFiles(async (tx, stored) => {
    const { c } = await ownDraft(tx, auth, id, now);
    assertWindowOpen(c, now);
    const { rx, reference } = await issueLocked(tx, { id, actorUserId: auth.user.id, now, stored });
    await notificationEvents.prescriptionIssued(tx, { prescriptionId: id, reference, patientUserId: rx.patient.userId, doctorName: rx.doctor.user.fullName, appointmentId: c.appointmentId, replaced: Boolean(rx.replacesPrescriptionId) });
  });
  return doctorView(prisma, id, now);
}

/** Correction: a new prescription (issued now) replaces the original, which becomes REPLACED and is kept. */
export async function replacePrescription(auth, id, { reason, items, generalNotes }, now = new Date()) {
  const newId = await inTransactionWithFiles(async (tx, stored) => {
    const doctor = await activeDoctor(tx, auth);
    const original = await lockedPrescription(tx, id);
    if (!original || original.doctorId !== doctor.id) throw notFound();
    if (original.status === 'REPLACED') throw ApiError.conflict('This prescription has already been replaced', undefined, Code.alreadyReplaced);
    if (!canTransition(original.status, 'REPLACED')) throw ApiError.conflict('Only a valid prescription can be replaced', { status: original.status }, Code.notValid);
    const c = await assignedConsultation(tx, doctor, original.consultationId);
    assertWindowOpen(c, now);

    const { id: draftId } = await prescriptionRepository.createDraft(tx, { consultationId: original.consultationId, patientId: original.patientId, doctorId: doctor.id, generalNotes, items: items.map(itemFields) });
    await prescriptionRepository.updatePrescription(tx, draftId, { replacesPrescriptionId: id });
    const { rx, reference } = await issueLocked(tx, { id: draftId, actorUserId: auth.user.id, now, stored });
    // Who (status_changed_by), when (replaced_at) and why (replacement_reason) live on the original itself.
    await prescriptionRepository.updatePrescription(tx, id, { status: 'REPLACED', replacedAt: now, replacementReason: reason, statusChangedByUserId: auth.user.id });
    await auditRepository.createAuditLog(tx, {
      actorUserId: auth.user.id,
      action: 'UPDATE',
      entityType: 'Prescription',
      entityId: id,
      oldValues: { status: 'VALID' },
      // Free-text reasons may be clinical: the audit log keeps the transition, not the text.
      newValues: { status: 'REPLACED', action: 'REPLACED', replacedBy: draftId, replacementReference: reference },
    });
    await notificationEvents.prescriptionIssued(tx, { prescriptionId: draftId, reference, patientUserId: rx.patient.userId, doctorName: rx.doctor.user.fullName, appointmentId: c.appointmentId, replaced: true });
    return draftId;
  });
  return doctorView(prisma, newId, now);
}

export async function cancelPrescription(auth, id, { reason }, now = new Date()) {
  await withTransaction(async (tx) => {
    const doctor = await activeDoctor(tx, auth);
    const rx = await lockedPrescription(tx, id);
    if (!rx || rx.doctorId !== doctor.id) throw notFound();
    if (!canTransition(rx.status, 'CANCELLED')) throw ApiError.conflict('Only a valid prescription can be cancelled', { status: rx.status }, Code.notValid);
    await prescriptionRepository.updatePrescription(tx, id, { status: 'CANCELLED', cancelledAt: now, cancellationReason: reason, cancelledByUserId: auth.user.id, statusChangedByUserId: auth.user.id });
    await auditRepository.createAuditLog(tx, { actorUserId: auth.user.id, action: 'UPDATE', entityType: 'Prescription', entityId: id, oldValues: { status: 'VALID' }, newValues: { status: 'CANCELLED', action: 'CANCELLED', reference: rx.reference } });
    const detail = await prescriptionRepository.findPrescriptionDetail(tx, id);
    await notificationEvents.prescriptionCancelled(tx, { prescriptionId: id, reference: rx.reference, patientUserId: detail.patient.userId, doctorName: detail.doctor.user.fullName });
  });
  return doctorView(prisma, id, now);
}

/* ------------------------------------------------------------------ reads */

const ownPatientId = (auth) => auth.user.patientProfile?.id ?? null;

/** Prescription for the patient who owns it (never drafts). Others get 404. */
async function patientPrescription(auth, id) {
  const rx = await prescriptionRepository.findPrescriptionDetail(prisma, id);
  if (!rx || rx.status === 'DRAFT' || rx.patientId !== ownPatientId(auth)) throw notFound();
  return rx;
}

/** Prescription written by the signed-in doctor (any status). Others get 404. */
async function doctorPrescription(auth, id) {
  const doctor = await doctorRepository.findDoctorByUserId(prisma, auth.user.id);
  const rx = doctor ? await prescriptionRepository.findPrescriptionDetail(prisma, id) : null;
  if (!rx || rx.doctorId !== doctor.id) throw notFound();
  return rx;
}

export async function getPrescription(auth, id, now = new Date()) {
  if (auth.activeRole === 'DOCTOR') {
    await doctorPrescription(auth, id);
    return doctorView(prisma, id, now);
  }
  return presentPrescription(await patientPrescription(auth, id), { viewer: 'PATIENT', now });
}

const presentListRow = (r) => ({
  id: r.id,
  reference: r.reference,
  status: r.status,
  issuedAt: r.issuedAt?.toISOString() ?? null,
  cancelledAt: r.cancelledAt?.toISOString() ?? null,
  replacedAt: r.replacedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
  itemCount: r._count.items,
  replaces: r.replaces,
  replacedBy: r.replacedBy,
  doctor: { name: r.doctor.user.fullName, specialty: r.doctor.specialty },
  patient: { name: r.patient.user.fullName },
  consultationId: r.consultationId,
  appointmentId: r.consultation.appointmentId,
});

export async function listMine(auth, { status, page, pageSize }) {
  const patientId = ownPatientId(auth);
  if (!patientId) throw ApiError.forbidden('A patient profile is required');
  if (status === 'DRAFT') return { items: [], total: 0, page, pageSize };
  const { total, rows } = await prescriptionRepository.listPrescriptions(prisma, { patientId, status: status ?? { not: 'DRAFT' } }, { page, pageSize });
  return { items: rows.map(presentListRow), total, page, pageSize };
}

export async function listForDoctor(auth, { status, page, pageSize }) {
  const doctor = await doctorRepository.findDoctorByUserId(prisma, auth.user.id);
  if (!doctor) throw ApiError.forbidden('Doctors only');
  const { total, rows } = await prescriptionRepository.listPrescriptions(prisma, { doctorId: doctor.id, ...(status ? { status } : {}) }, { page, pageSize });
  return { items: rows.map(presentListRow), total, page, pageSize };
}

/** Prescriptions of one consultation, for its patient (issued only) or its assigned doctor (with drafts + window). */
export async function listForConsultation(auth, consultationId, now = new Date()) {
  const c = await prescriptionRepository.findConsultationForPrescribing(prisma, consultationId);
  if (!c) throw ApiError.notFound('Consultation not found');
  const isDoctor = auth.activeRole === 'DOCTOR' && c.doctor.userId === auth.user.id;
  const isPatient = auth.activeRole === 'PATIENT' && c.patient.userId === auth.user.id;
  if (!isDoctor && !isPatient) throw ApiError.notFound('Consultation not found');
  const rows = await prescriptionRepository.listForConsultation(prisma, consultationId, { includeDrafts: isDoctor });
  const w = issueWindow(c, now);
  const doctorActive = c.doctor.verificationStatus === 'VERIFIED' && c.doctor.accountStatus === 'ACTIVE';
  return {
    items: rows.map(presentListRow),
    ...(isDoctor ? { window: { open: w.open && doctorActive && ELIGIBLE_APPOINTMENT_STATUSES.includes(c.appointment.status), closesAt: w.closesAt?.toISOString() ?? null, reason: doctorActive ? w.reason : 'DOCTOR_NOT_ACTIVE' } } : {}),
  };
}

/**
 * The stored PDF for the owning patient or the prescribing doctor. Its SHA-256 is verified before it is
 * served; on mismatch nothing is returned and a security event is audited (without content).
 */
export async function getPdf(auth, id) {
  const rx = auth.activeRole === 'DOCTOR' ? await doctorPrescription(auth, id) : await patientPrescription(auth, id);
  if (rx.status === 'DRAFT' || !rx.pdfFileKey || !rx.pdfSha256) throw new ApiError(404, 'No PDF for this prescription', undefined, Code.pdfUnavailable);
  let buffer;
  try {
    buffer = await getPrivateObject(rx.pdfFileKey);
  } catch {
    throw new ApiError(404, 'The prescription PDF is unavailable', undefined, Code.pdfUnavailable);
  }
  if (sha256(buffer) !== rx.pdfSha256) {
    await auditRepository.createAuditLog(prisma, { actorUserId: auth.user.id, action: 'OTHER', entityType: 'SecurityEvent', entityId: id, newValues: { event: 'PRESCRIPTION_PDF_CHECKSUM_MISMATCH', reference: rx.reference } });
    throw new ApiError(409, 'The prescription PDF failed its integrity check and was not served', undefined, Code.pdfIntegrity);
  }
  await auditRepository.createAuditLog(prisma, { actorUserId: auth.user.id, action: 'OTHER', entityType: 'Prescription', entityId: id, newValues: { action: 'PDF_DOWNLOADED', reference: rx.reference, by: auth.activeRole } });
  return { buffer, fileName: `${rx.reference}.pdf` };
}
