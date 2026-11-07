import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { getPrivateObject, putPrivateObject, removePrivateObject, signedDownloadUrl } from '../../adapters/storage/privateStorage.js';
import { consumeUploadIntent, createUploadIntent } from '../storage/uploadIntent.service.js';
import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { detectDocumentType, safeDisplayName } from '../../utils/fileType.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';
import * as notificationEvents from '../notifications/notification.events.js';

/**
 * Consultation documents (lab results, reports, referral letters…) shared between ONE patient and the
 * consultation's assigned doctor. Nobody else — not other doctors, not administrators — can list, read or
 * download them. Files live in private storage under generated keys; the browser's name and MIME type are
 * never trusted. Documents are archived, never deleted (database trigger).
 */
export const MAX_MEDICAL_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DOCUMENT_CATEGORIES = Object.freeze(['LAB_RESULT', 'MEDICAL_REPORT', 'REFERRAL_LETTER', 'DIAGNOSTIC_REPORT', 'SCANNED_DOCUMENT', 'OTHER']);
const ELIGIBLE_APPOINTMENT_STATUSES = ['WAITING', 'IN_PROGRESS', 'COMPLETED'];

export const DocumentErrorCode = Object.freeze({
  notFound: 'DOCUMENT_NOT_FOUND',
  empty: 'FILE_EMPTY',
  tooLarge: 'PAYLOAD_TOO_LARGE',
  type: 'FILE_TYPE_NOT_ALLOWED',
  malformed: 'FILE_MALFORMED',
  archived: 'DOCUMENT_ARCHIVED',
  forbidden: 'DOCUMENT_FORBIDDEN',
  notEligible: 'CONSULTATION_NOT_ELIGIBLE',
  integrity: 'DOCUMENT_INTEGRITY',
});

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const notFound = () => new ApiError(404, 'Document not found', undefined, DocumentErrorCode.notFound);

/**
 * Validates a medical document from its bytes: size, magic bytes (PDF / JPEG / PNG only), and structure
 * (images must fully decode; PDFs need a header and an end-of-file marker). Returns { mime, ext }.
 */
export async function validateMedicalDocument(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw ApiError.badRequest('The file is empty', undefined, DocumentErrorCode.empty);
  if (buffer.length > MAX_MEDICAL_DOCUMENT_BYTES) throw new ApiError(413, 'The file is larger than 10 MB', undefined, DocumentErrorCode.tooLarge);
  const type = detectDocumentType(buffer);
  if (!type) throw new ApiError(415, 'Only PDF, JPEG or PNG files are accepted', undefined, DocumentErrorCode.type);
  if (type.ext === 'pdf') {
    if (!buffer.subarray(Math.max(0, buffer.length - 2048)).toString('latin1').includes('%%EOF')) {
      throw new ApiError(422, 'The PDF file is incomplete or damaged', undefined, DocumentErrorCode.malformed);
    }
  } else {
    try {
      const meta = await sharp(buffer, { limitInputPixels: 50_000_000, failOn: 'error' }).metadata();
      if (meta.format !== (type.ext === 'jpg' ? 'jpeg' : 'png')) throw new Error('format mismatch');
      await sharp(buffer, { limitInputPixels: 50_000_000, failOn: 'error' }).stats(); // full decode
    } catch {
      throw new ApiError(422, 'The image could not be read', undefined, DocumentErrorCode.malformed);
    }
  }
  return type;
}

/** The consultation and who the caller is in it, or 404 for everyone else (no existence leak). */
async function participation(client, auth, consultationId) {
  const c = await client.consultation.findUnique({
    where: { id: consultationId },
    select: {
      id: true,
      appointmentId: true,
      patientId: true,
      doctorId: true,
      appointment: { select: { status: true } },
      patient: { select: { userId: true } },
      doctor: { select: { userId: true, verificationStatus: true, accountStatus: true } },
    },
  });
  if (!c) throw ApiError.notFound('Consultation not found');
  if (auth.activeRole === 'PATIENT' && c.patient.userId === auth.user.id) return { c, role: 'PATIENT' };
  if (auth.activeRole === 'DOCTOR' && c.doctor.userId === auth.user.id) {
    if (c.doctor.verificationStatus !== 'VERIFIED' || c.doctor.accountStatus !== 'ACTIVE') throw ApiError.forbidden('Your doctor account is not active', undefined, 'DOCTOR_NOT_ACTIVE');
    return { c, role: 'DOCTOR' };
  }
  throw ApiError.notFound('Consultation not found');
}

const DOC_SELECT = Object.freeze({
  id: true,
  consultationId: true,
  uploadedByUserId: true,
  fileKey: true,
  fileName: true,
  mimeType: true,
  fileSize: true,
  category: true,
  description: true,
  sha256: true,
  archivedAt: true,
  createdAt: true,
  uploadedBy: { select: { fullName: true } },
  consultation: {
    select: {
      id: true,
      appointmentId: true,
      patient: { select: { userId: true } },
      doctor: { select: { userId: true, verificationStatus: true, accountStatus: true, user: { select: { fullName: true } } } },
      appointment: { select: { startAtUtc: true } },
    },
  },
});

/** Client view: never the storage key or checksum. */
export function presentDocument(d, auth) {
  const uploaderRole = d.uploadedByUserId === d.consultation.patient.userId ? 'PATIENT' : 'DOCTOR';
  const mine = d.uploadedByUserId === auth.user.id;
  const isPatientOwner = auth.activeRole === 'PATIENT' && d.consultation.patient.userId === auth.user.id;
  return {
    id: d.id,
    consultationId: d.consultationId,
    appointmentId: d.consultation.appointmentId,
    consultationDate: d.consultation.appointment?.startAtUtc?.toISOString() ?? null,
    doctor: { name: d.consultation.doctor.user.fullName },
    category: d.category,
    fileName: d.fileName,
    mimeType: d.mimeType,
    fileSize: d.fileSize,
    description: d.description ?? null,
    uploadedBy: { role: uploaderRole, name: d.uploadedBy.fullName, isMe: mine },
    createdAt: d.createdAt.toISOString(),
    archivedAt: d.archivedAt?.toISOString() ?? null,
    canArchive: !d.archivedAt && (isPatientOwner || mine),
  };
}

export async function uploadDocument(auth, consultationId, { buffer, fileName, category, description }) {
  // Authorise first: strangers never get the (potentially expensive) file validation.
  const { c, role } = await participation(prisma, auth, consultationId);
  if (!ELIGIBLE_APPOINTMENT_STATUSES.includes(c.appointment.status)) {
    throw ApiError.conflict('Documents can be shared only for a consultation that took place', { status: c.appointment.status }, DocumentErrorCode.notEligible);
  }
  if (!DOCUMENT_CATEGORIES.includes(category)) throw ApiError.badRequest('Unknown document category');
  const type = await validateMedicalDocument(buffer);
  const fileKey = `medical-documents/${consultationId}/${randomUUID()}.${type.ext}`;
  await putPrivateObject(fileKey, buffer);
  try {
    const id = await withTransaction(async (tx) => {
      const row = await tx.consultationAttachment.create({
        data: {
          consultationId,
          uploadedByUserId: auth.user.id,
          fileKey,
          fileName: safeDisplayName(fileName, type.ext),
          mimeType: type.mime,
          fileSize: buffer.length,
          attachmentType: type.ext === 'pdf' ? 'PDF' : 'IMAGE',
          category,
          description: description ?? null,
          sha256: sha256(buffer),
        },
        select: { id: true },
      });
      // No file name or description in the audit log (they can be clinical).
      await auditRepository.createAuditLog(tx, { actorUserId: auth.user.id, action: 'CREATE', entityType: 'MedicalDocument', entityId: row.id, newValues: { consultationId, category, mimeType: type.mime, bytes: buffer.length, uploadedBy: role } });
      await notificationEvents.documentAdded(tx, { documentId: row.id, appointmentId: c.appointmentId, uploadedBy: role });
      return row.id;
    });
    return presentDocument(await prisma.consultationAttachment.findUnique({ where: { id }, select: DOC_SELECT }), auth);
  } catch (error) {
    await removePrivateObject(fileKey).catch(() => {});
    throw error;
  }
}

/**
 * Large-file upload, step 1 (the path used by the web app; required on Vercel, whose request bodies are
 * limited to ~4.5 MB): authorise the participant and the consultation, then issue a staging upload URL.
 */
export async function initiateUpload(auth, consultationId, { category, description, fileName, size, contentType }) {
  const { c } = await participation(prisma, auth, consultationId);
  if (!ELIGIBLE_APPOINTMENT_STATUSES.includes(c.appointment.status)) {
    throw ApiError.conflict('Documents can be shared only for a consultation that took place', { status: c.appointment.status }, DocumentErrorCode.notEligible);
  }
  return createUploadIntent(auth, {
    purpose: 'medical-document',
    target: { consultationId },
    meta: { category, description: description ?? null, fileName: String(fileName ?? '').slice(0, 300) },
    declared: { size, contentType },
    maxBytes: MAX_MEDICAL_DOCUMENT_BYTES,
  });
}

/**
 * Step 2: claim the staged bytes, then the normal upload path re-authorises the caller and validates the
 * real bytes (type from content, structure, size, SHA-256) before storing and recording the document.
 */
export async function finalizeUpload(auth, consultationId, uploadToken) {
  await participation(prisma, auth, consultationId); // authorise before touching any staged bytes
  const { buffer, meta } = await consumeUploadIntent(auth, uploadToken, { purpose: 'medical-document', target: { consultationId } });
  return uploadDocument(auth, consultationId, { buffer, fileName: meta.fileName, category: meta.category, description: meta.description ?? undefined });
}

/** Short-lived signed download URL — only after the access check and an audit entry. */
export async function getDownloadUrl(auth, id) {
  const d = await accessibleDocument(prisma, auth, id);
  await auditRepository.createAuditLog(prisma, { actorUserId: auth.user.id, action: 'OTHER', entityType: 'MedicalDocument', entityId: id, newValues: { action: 'SIGNED_URL_ISSUED', by: auth.activeRole } });
  return signedDownloadUrl(d.fileKey, { downloadName: d.fileName });
}

export async function listForConsultation(auth, consultationId, { includeArchived = false } = {}) {
  await participation(prisma, auth, consultationId);
  const rows = await prisma.consultationAttachment.findMany({
    where: { consultationId, ...(includeArchived ? {} : { archivedAt: null }) },
    select: DOC_SELECT,
    orderBy: { createdAt: 'desc' },
  });
  return { items: rows.map((d) => presentDocument(d, auth)) };
}

/** Every document of the signed-in patient's consultations. */
export async function listMine(auth, { includeArchived = false, category } = {}) {
  const patientId = auth.user.patientProfile?.id;
  if (!patientId) throw ApiError.forbidden('A patient profile is required');
  const rows = await prisma.consultationAttachment.findMany({
    where: { consultation: { patientId }, ...(includeArchived ? {} : { archivedAt: null }), ...(category ? { category } : {}) },
    select: DOC_SELECT,
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  return { items: rows.map((d) => presentDocument(d, auth)) };
}

/** A document the caller may access (consultation's patient or its active assigned doctor), else 404. */
async function accessibleDocument(client, auth, id) {
  const d = await client.consultationAttachment.findUnique({ where: { id }, select: DOC_SELECT });
  if (!d) throw notFound();
  const isPatient = auth.activeRole === 'PATIENT' && d.consultation.patient.userId === auth.user.id;
  const doc = d.consultation.doctor;
  const isDoctor = auth.activeRole === 'DOCTOR' && doc.userId === auth.user.id;
  if (!isPatient && !isDoctor) throw notFound();
  if (isDoctor && (doc.verificationStatus !== 'VERIFIED' || doc.accountStatus !== 'ACTIVE')) throw ApiError.forbidden('Your doctor account is not active', undefined, 'DOCTOR_NOT_ACTIVE');
  return d;
}

export async function getDocument(auth, id) {
  return presentDocument(await accessibleDocument(prisma, auth, id), auth);
}

export async function downloadDocument(auth, id) {
  const d = await accessibleDocument(prisma, auth, id);
  let buffer;
  try {
    buffer = await getPrivateObject(d.fileKey);
  } catch {
    throw notFound();
  }
  if (d.sha256 && sha256(buffer) !== d.sha256) {
    await auditRepository.createAuditLog(prisma, { actorUserId: auth.user.id, action: 'OTHER', entityType: 'SecurityEvent', entityId: id, newValues: { event: 'MEDICAL_DOCUMENT_CHECKSUM_MISMATCH' } });
    throw new ApiError(409, 'The document failed its integrity check and was not served', undefined, DocumentErrorCode.integrity);
  }
  await auditRepository.createAuditLog(prisma, { actorUserId: auth.user.id, action: 'OTHER', entityType: 'MedicalDocument', entityId: id, newValues: { action: 'DOWNLOADED', by: auth.activeRole } });
  return { buffer, mimeType: d.mimeType, fileName: d.fileName };
}

/** Archive (never delete): the consultation's patient, or whoever uploaded it. Archived = frozen. */
export async function archiveDocument(auth, id, now = new Date()) {
  await withTransaction(async (tx) => {
    if (!(await lockRow(tx, 'consultation_attachments', id))) throw notFound();
    const d = await accessibleDocument(tx, auth, id);
    if (d.archivedAt) throw ApiError.conflict('This document is already archived', undefined, DocumentErrorCode.archived);
    const isPatientOwner = auth.activeRole === 'PATIENT' && d.consultation.patient.userId === auth.user.id;
    if (!isPatientOwner && d.uploadedByUserId !== auth.user.id) throw ApiError.forbidden('Only the patient or the person who shared it can archive this document', undefined, DocumentErrorCode.forbidden);
    await tx.consultationAttachment.update({ where: { id }, data: { archivedAt: now, archivedByUserId: auth.user.id } });
    await auditRepository.createAuditLog(tx, { actorUserId: auth.user.id, action: 'UPDATE', entityType: 'MedicalDocument', entityId: id, newValues: { archived: true, by: auth.activeRole } });
  });
  return getDocument(auth, id);
}
