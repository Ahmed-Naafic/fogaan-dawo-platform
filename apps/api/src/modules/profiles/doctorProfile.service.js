import { randomUUID } from 'node:crypto';
import { putPrivateObject, removePrivateObject } from '../../adapters/storage/privateStorage.js';
import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { detectDocumentType, MAX_DOCUMENT_BYTES, safeDisplayName } from '../../utils/fileType.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';
import { DoctorErrorCode } from '../doctors/doctorApplication.constants.js';
import { presentApplication } from '../doctors/doctorApplication.presenter.js';
import * as doctorRepository from '../doctors/doctor.repository.js';
import { addDocumentVersion } from '../doctors/doctor.service.js';
import * as notificationEvents from '../notifications/notification.events.js';
import { doctorCompleteness } from './profile.completeness.js';
import { photoInfo } from './profilePhoto.service.js';

/**
 * The approved doctor's own professional profile (routes require the DOCTOR role, which only a
 * verified doctor holds). The doctor is always `auth.user`.
 *
 * Freely editable while VERIFIED + ACTIVE: biography, qualifications, years of experience, languages,
 * consultation fee (new bookings only — every appointment keeps its own fee_amount snapshot).
 * Never editable here: verification status/dates, account status, specialty, professional name.
 * Licence number/country change only together with a new licence file, through the existing Option A
 * re-verification (addDocumentVersion): PENDING + new verification request + DOCTOR role removed +
 * open slots withdrawn, in one transaction. Slots are never restored automatically afterwards.
 */
export const DoctorProfileErrorCode = Object.freeze({
  notFound: 'DOCTOR_PROFILE_NOT_FOUND',
  locked: 'DOCTOR_PROFILE_LOCKED',
});

const isListed = (p) => p.verificationStatus === 'VERIFIED' && p.accountStatus === 'ACTIVE' && p.user.status === 'ACTIVE';

export function presentDoctorProfile(profile) {
  const base = presentApplication(profile);
  const latest = base.latestRequest;
  const listed = isListed(profile);
  // Applicant-facing fields the doctor profile does not need (documents stay on the application page).
  const { documentHistory: _h, history: _r, editable: _e, completion: _c, rejectionReason, ...rest } = base;
  const presented = {
    ...rest,
    photo: photoInfo(profile.user),
    listedPublicly: listed,
    publicProfilePath: listed ? `/doctors/${profile.id}` : null,
    nameLocked: true,
    verification: {
      status: profile.verificationStatus,
      verifiedAt: profile.verifiedAt?.toISOString() ?? null,
      latestRequest: latest,
      // A pending request that follows an earlier approval is a re-verification (e.g. licence replaced).
      reverificationPending: ['PENDING', 'UNDER_REVIEW'].includes(profile.verificationStatus) && profile.verificationRequests.some((r) => r.status === 'APPROVED'),
      rejectionReason: profile.verificationStatus === 'REJECTED' ? rejectionReason : null,
    },
    licenceDocument: base.documents.find((d) => d.documentType === 'MEDICAL_LICENSE') ?? null,
  };
  return { ...presented, completeness: doctorCompleteness(presented) };
}

async function loadOwn(client, auth) {
  const profile = await doctorRepository.findApplicationByUserId(client, auth.user.id);
  if (!profile) throw ApiError.notFound('Doctor profile not found');
  return profile;
}

export async function getMyProfessionalProfile(auth) {
  return presentDoctorProfile(await loadOwn(prisma, auth));
}

export async function updateMyProfessionalProfile(auth, input) {
  await withTransaction(async (tx) => {
    const own = await doctorRepository.findDoctorByUserId(tx, auth.user.id);
    if (!own) throw ApiError.notFound('Doctor profile not found');
    await lockRow(tx, 'doctor_profiles', own.id);
    const fresh = await doctorRepository.findDoctorById(tx, own.id);
    if (fresh.verificationStatus !== 'VERIFIED' || fresh.accountStatus !== 'ACTIVE') {
      throw ApiError.conflict('Your professional profile can be edited only while you are verified and active', { status: fresh.verificationStatus, accountStatus: fresh.accountStatus }, DoctorProfileErrorCode.locked);
    }
    const data = {};
    if ('bio' in input) data.bio = input.bio;
    if ('qualifications' in input) data.qualifications = input.qualifications;
    if ('yearsExperience' in input) data.yearsExperience = input.yearsExperience;
    if ('consultationFee' in input) data.consultationFee = input.consultationFee.toFixed(2);
    if (Object.keys(data).length) await doctorRepository.updateDoctor(tx, own.id, data);
    if ('languages' in input) await doctorRepository.replaceDoctorLanguages(tx, own.id, input.languages);
    const feeChanged = 'consultationFee' in input && fresh.consultationFee.toFixed(2) !== data.consultationFee;
    await auditRepository.createAuditLog(tx, {
      actorUserId: auth.user.id,
      action: 'UPDATE',
      entityType: 'DoctorProfile',
      entityId: own.id,
      oldValues: feeChanged ? { consultationFee: fresh.consultationFee.toFixed(2) } : undefined,
      newValues: { fields: Object.keys(input).sort(), ...(feeChanged ? { consultationFee: data.consultationFee, appliesTo: 'new bookings only' } : {}) },
    });
  });
  return getMyProfessionalProfile(auth);
}

/**
 * Replaces the medical licence (file + number + country) and starts re-verification (Option A).
 * The file is validated from its bytes (PDF, JPEG or PNG, ≤ 5 MB) and stored privately, exactly like
 * application documents.
 */
export async function replaceMyLicence(auth, { buffer, fileName, licenceNumber, licenceCountry }, now = new Date()) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw ApiError.badRequest('The file is empty', undefined, DoctorErrorCode.fileEmpty);
  if (buffer.length > MAX_DOCUMENT_BYTES) throw new ApiError(413, 'The file is larger than 5 MB', undefined, 'PAYLOAD_TOO_LARGE');
  const type = detectDocumentType(buffer);
  if (!type) throw new ApiError(415, 'Only PDF, JPEG or PNG files are accepted', undefined, DoctorErrorCode.fileTypeNotAllowed);

  const own = await doctorRepository.findDoctorByUserId(prisma, auth.user.id);
  if (!own) throw ApiError.notFound('Doctor profile not found');

  const fileKey = `doctor-documents/${own.id}/${randomUUID()}.${type.ext}`;
  await putPrivateObject(fileKey, buffer);
  let result;
  try {
    result = await addDocumentVersion({
      doctorId: own.id,
      documentType: 'MEDICAL_LICENSE',
      fileKey,
      fileName: safeDisplayName(fileName, type.ext),
      mimeType: type.mime,
      fileSize: buffer.length,
      allowedStatuses: ['VERIFIED'], // checked under the row lock
      actorUserId: auth.user.id,
      licenceDetails: { licenceNumber, licenceCountry },
      now,
    });
  } catch (error) {
    await removePrivateObject(fileKey).catch(() => {});
    if (error.code === 'APPLICATION_LOCKED') {
      throw ApiError.conflict('The licence can be replaced here only while you are verified', error.details, DoctorProfileErrorCode.locked);
    }
    throw error;
  }
  if (result.verificationRequest) {
    // Same admin notification as a new submission, so the re-verification appears in the review queue.
    await notificationEvents
      .applicationSubmitted(prisma, { requestId: result.verificationRequest.id, doctorId: own.id, applicantName: auth.user.fullName, applicantUserId: auth.user.id })
      .catch(() => {});
  }
  return {
    status: 'PENDING',
    reverificationRequired: Boolean(result.verificationRequest),
    doctorRoleRemoved: result.privileges?.doctorRoleRemoved ?? false,
    slotsWithdrawn: result.privileges?.slotsWithdrawn ?? 0,
  };
}
