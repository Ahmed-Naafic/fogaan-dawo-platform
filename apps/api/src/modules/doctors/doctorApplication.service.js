import { randomUUID } from 'node:crypto';
import { getPrivateObject, putPrivateObject, removePrivateObject } from '../../adapters/storage/privateStorage.js';
import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { detectDocumentType, MAX_DOCUMENT_BYTES, safeDisplayName } from '../../utils/fileType.js';
import { lockRow, rethrowConflict, withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';
import * as notificationEvents from '../notifications/notification.events.js';
import * as userRepository from '../users/user.repository.js';
import { DoctorErrorCode, EDITABLE_STATUSES } from './doctorApplication.constants.js';
import { completionOf, presentApplication, presentDocument } from './doctorApplication.presenter.js';
import * as doctorRepository from './doctor.repository.js';
import { addDocumentVersion } from './doctor.service.js';

/**
 * The applicant's own doctor application. Every function is scoped to `auth.user.id`: an applicant can
 * never address another applicant's application. Submitting never grants the DOCTOR role — only an
 * administrator's approval does (doctorVerification.service.js).
 */

const notFound = () => ApiError.notFound('You have not started a doctor application yet');
const locked = (status) =>
  ApiError.conflict('The application cannot be changed while it is being reviewed or after approval', { status }, DoctorErrorCode.applicationLocked);

/** Public list of active specialties for the application form (bilingual names). */
export const listSpecialties = () => doctorRepository.listActiveSpecialties(prisma);

export async function getMyApplication(auth) {
  const profile = await doctorRepository.findApplicationByUserId(prisma, auth.user.id);
  return profile ? presentApplication(profile) : null;
}

/** Creates the application as a draft (NOT_SUBMITTED) or updates a draft / rejected application. */
export async function saveMyApplication(auth, input) {
  try {
    await withTransaction(async (tx) => {
      const specialty = await doctorRepository.findSpecialtyById(tx, input.specialtyId);
      if (!specialty || !specialty.isActive) throw ApiError.badRequest('Choose a valid specialty', [{ path: 'specialtyId', message: 'Unknown specialty' }], DoctorErrorCode.specialtyNotFound);

      const fields = {
        specialtyId: input.specialtyId,
        licenceNumber: input.licenceNumber,
        licenceCountry: input.licenceCountry,
        consultationFee: input.consultationFee.toFixed(2),
        bio: input.bio,
        yearsExperience: input.yearsExperience ?? null,
      };
      const existing = await doctorRepository.findDoctorByUserId(tx, auth.user.id);
      let doctorId;
      if (existing) {
        await lockRow(tx, 'doctor_profiles', existing.id);
        const fresh = await doctorRepository.findDoctorById(tx, existing.id);
        if (!EDITABLE_STATUSES.includes(fresh.verificationStatus)) throw locked(fresh.verificationStatus);
        await doctorRepository.updateDoctor(tx, existing.id, fields);
        doctorId = existing.id;
      } else {
        doctorId = (await doctorRepository.createDoctorProfile(tx, { userId: auth.user.id, ...fields, verificationStatus: 'NOT_SUBMITTED' })).id;
      }
      await doctorRepository.replaceDoctorLanguages(tx, doctorId, input.languages);
      await userRepository.updateUserFullName(tx, auth.user.id, input.professionalName);
      await auditRepository.createAuditLog(tx, {
        actorUserId: auth.user.id,
        action: existing ? 'UPDATE' : 'CREATE',
        entityType: 'DoctorApplication',
        entityId: doctorId,
        newValues: { specialtyId: fields.specialtyId, consultationFee: fields.consultationFee, languages: input.languages },
      });
    });
  } catch (error) {
    rethrowConflict(error, 'A doctor application already exists for this account');
  }
  return getMyApplication(auth);
}

/**
 * Stores a supporting document. The type is detected from the file's bytes (PDF, JPEG or PNG only);
 * the browser's filename/MIME type are ignored except as a sanitised display name. Replacing a document
 * keeps every earlier version.
 */
export async function uploadMyDocument(auth, { documentType, buffer, fileName }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw ApiError.badRequest('The file is empty', undefined, DoctorErrorCode.fileEmpty);
  if (buffer.length > MAX_DOCUMENT_BYTES) throw new ApiError(413, 'The file is larger than 5 MB', undefined, 'PAYLOAD_TOO_LARGE');
  const type = detectDocumentType(buffer);
  if (!type) throw new ApiError(415, 'Only PDF, JPEG or PNG files are accepted', undefined, DoctorErrorCode.fileTypeNotAllowed);

  const profile = await doctorRepository.findDoctorByUserId(prisma, auth.user.id);
  if (!profile) throw ApiError.conflict('Save your application details before uploading documents', undefined, DoctorErrorCode.applicationNotFound);

  const fileKey = `doctor-documents/${profile.id}/${randomUUID()}.${type.ext}`;
  await putPrivateObject(fileKey, buffer);
  let document;
  try {
    ({ document } = await addDocumentVersion({
      doctorId: profile.id,
      documentType,
      fileKey,
      fileName: safeDisplayName(fileName, type.ext),
      mimeType: type.mime,
      fileSize: buffer.length,
      allowedStatuses: EDITABLE_STATUSES,
      actorUserId: auth.user.id,
    }));
  } catch (error) {
    await removePrivateObject(fileKey).catch(() => {});
    if (error.code === DoctorErrorCode.applicationLocked) throw locked(error.details?.status);
    throw error;
  }
  await auditRepository.createAuditLog(prisma, {
    actorUserId: auth.user.id,
    action: 'CREATE',
    entityType: 'DoctorDocument',
    entityId: document.id,
    newValues: { documentType, versionNumber: document.versionNumber, mimeType: document.mimeType, fileSize: document.fileSize },
  });
  return presentDocument(document);
}

/** Returns { buffer, fileName, mimeType } for one of the applicant's own documents. */
export async function getMyDocumentFile(auth, documentId) {
  const profile = await doctorRepository.findDoctorByUserId(prisma, auth.user.id);
  const doc = profile ? await doctorRepository.findDocumentForDownload(prisma, { doctorId: profile.id, documentId }) : null;
  if (!doc) throw ApiError.notFound('Document not found'); // also for other people's documents: no existence leak
  return { buffer: await getPrivateObject(doc.fileKey), fileName: doc.fileName, mimeType: doc.mimeType };
}

/** Submits (or resubmits after rejection) the application for administrator verification. */
export async function submitMyApplication(auth, now = new Date()) {
  const profile = await doctorRepository.findDoctorByUserId(prisma, auth.user.id);
  if (!profile) throw notFound();
  await withTransaction(async (tx) => {
    await lockRow(tx, 'doctor_profiles', profile.id);
    const application = await doctorRepository.findApplicationById(tx, profile.id);
    if (!EDITABLE_STATUSES.includes(application.verificationStatus)) throw locked(application.verificationStatus);
    const completion = completionOf(application);
    if (!completion.readyToSubmit) {
      throw ApiError.conflict('Complete the required details and documents before submitting', { missing: completion.missing.filter((m) => m.required).map((m) => m.key) }, DoctorErrorCode.applicationIncomplete);
    }
    const request = await doctorRepository.createVerificationRequest(tx, { doctorId: profile.id, status: 'PENDING', submittedAt: now });
    await doctorRepository.updateDoctor(tx, profile.id, { verificationStatus: 'PENDING', verifiedAt: null });
    await auditRepository.createAuditLog(tx, {
      actorUserId: auth.user.id,
      action: 'CREATE',
      entityType: 'VerificationRequest',
      entityId: request.id,
      newValues: { doctorId: profile.id, resubmission: application.verificationStatus === 'REJECTED' },
    });
    await notificationEvents.applicationSubmitted(tx, { requestId: request.id, doctorId: profile.id, applicantName: application.user.fullName, applicantUserId: auth.user.id });
  });
  return getMyApplication(auth);
}
