import { getPrivateObject, signedDownloadUrl } from '../../adapters/storage/privateStorage.js';
import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';
import * as authRepository from '../auth/auth.repository.js';
import * as notificationEvents from '../notifications/notification.events.js';
import { ADMIN_TABS, DoctorErrorCode } from './doctorApplication.constants.js';
import { presentApplication, presentApplicationForAdmin } from './doctorApplication.presenter.js';
import * as doctorRepository from './doctor.repository.js';
import { revokeDoctorPrivileges } from './doctorPrivileges.service.js';

/**
 * Administrator verification of doctor applications. Route-level RBAC already requires an active
 * ADMIN session with the doctors:verify permission; this service adds the business rules:
 * nobody reviews their own application, decisions follow the status lifecycle, and the DOCTOR role is
 * granted only on approval, in the same transaction, with an audit trail.
 */

/** What each decision requires and produces. */
const DECISIONS = Object.freeze({
  START_REVIEW: { from: ['PENDING'], request: 'UNDER_REVIEW', doctor: 'UNDER_REVIEW', resolves: false },
  APPROVE: { from: ['PENDING', 'UNDER_REVIEW'], request: 'APPROVED', doctor: 'VERIFIED', resolves: true },
  REJECT: { from: ['PENDING', 'UNDER_REVIEW'], request: 'REJECTED', doctor: 'REJECTED', resolves: true },
});

/** GET /api/v1/admin/doctor-applications: applications per tab (pending, under review, verified, rejected). */
export async function listApplications({ tab = 'pending' } = {}) {
  const [rows, counts] = await Promise.all([doctorRepository.listApplicationsByStatus(prisma, ADMIN_TABS[tab]), doctorRepository.countApplicationsByStatus(prisma)]);
  return {
    tab,
    counts: {
      pending: (counts.PENDING ?? 0) + (counts.UNDER_REVIEW ?? 0),
      verified: counts.VERIFIED ?? 0,
      rejected: counts.REJECTED ?? 0,
    },
    items: rows.map((r) => ({
      doctorId: r.id,
      status: r.verificationStatus,
      name: r.user.fullName,
      userId: r.user.id,
      specialty: r.specialty,
      submittedAt: r.verificationRequests[0]?.submittedAt ?? null,
      resolvedAt: r.verificationRequests[0]?.resolvedAt ?? null,
    })),
  };
}

/** GET /api/v1/admin/doctor-applications/:id: one application with documents and review history. */
export async function getApplication(doctorId) {
  const profile = await doctorRepository.findApplicationById(prisma, doctorId);
  if (!profile || profile.verificationStatus === 'NOT_SUBMITTED') throw ApiError.notFound('Application not found'); // drafts stay private
  return presentApplicationForAdmin(profile);
}

/** An application document file for an administrator (bytes and content type). Audited. */
export async function getApplicationDocumentFile({ doctorId, documentId }) {
  const profile = await doctorRepository.findDoctorById(prisma, doctorId);
  const doc = profile && profile.verificationStatus !== 'NOT_SUBMITTED' ? await doctorRepository.findDocumentForDownload(prisma, { doctorId, documentId }) : null;
  if (!doc) throw ApiError.notFound('Document not found');
  return { buffer: await getPrivateObject(doc.fileKey), fileName: doc.fileName, mimeType: doc.mimeType };
}

/** Short-lived signed URL for an administrator reviewing a submitted application (audited first). */
export async function getApplicationDocumentUrl({ doctorId, documentId, actorUserId }) {
  const profile = await doctorRepository.findDoctorById(prisma, doctorId);
  const doc = profile && profile.verificationStatus !== 'NOT_SUBMITTED' ? await doctorRepository.findDocumentForDownload(prisma, { doctorId, documentId }) : null;
  if (!doc) throw ApiError.notFound('Document not found');
  await auditRepository.createAuditLog(prisma, { actorUserId, action: 'OTHER', entityType: 'DoctorDocument', entityId: doc.id, newValues: { action: 'SIGNED_URL_ISSUED', by: 'ADMIN', doctorId } });
  return signedDownloadUrl(doc.fileKey, { downloadName: doc.fileName });
}

/**
 * The single decision path (also used by doctor.service.reviewVerification).
 * decision: START_REVIEW | APPROVE | REJECT. REJECT requires a reason (`notes`).
 */
export async function decideApplication({ doctorId, reviewerUserId, decision, notes = null, now = new Date() }) {
  const rule = DECISIONS[decision];
  if (!rule) throw ApiError.badRequest(`Unknown decision ${decision}`);
  if (decision === 'REJECT' && !(typeof notes === 'string' && notes.trim().length >= 10)) {
    throw ApiError.badRequest('A rejection reason of at least 10 characters is required', [{ path: 'reason', message: 'Reason is required' }], 'VALIDATION_ERROR');
  }

  await withTransaction(async (tx) => {
    if (!(await lockRow(tx, 'doctor_profiles', doctorId))) throw ApiError.notFound('Application not found');
    const doctor = await doctorRepository.findDoctorById(tx, doctorId);
    if (doctor.userId === reviewerUserId) throw ApiError.forbidden('You cannot review your own doctor application', undefined, DoctorErrorCode.selfReview);

    const request = await doctorRepository.findLatestVerificationRequest(tx, doctorId);
    if (!request || !rule.from.includes(request.status)) {
      throw ApiError.conflict('This application is not awaiting this decision', { decision, status: request?.status ?? doctor.verificationStatus }, DoctorErrorCode.invalidTransition);
    }

    await doctorRepository.createVerificationReview(tx, { verificationRequestId: request.id, reviewerUserId, status: rule.request, notes: notes?.trim() || null });
    await doctorRepository.updateVerificationRequest(tx, request.id, { status: rule.request, resolvedAt: rule.resolves ? now : null });
    await doctorRepository.updateDoctor(tx, doctorId, { verificationStatus: rule.doctor, verifiedAt: decision === 'APPROVE' ? now : null });

    // A rejected doctor never keeps DOCTOR privileges (also repairs any doctor who still held the role
    // from a re-verification started before this rule): role removed, open slots withdrawn, audited.
    if (decision === 'REJECT') await revokeDoctorPrivileges(tx, { doctorId, actorUserId: reviewerUserId, reason: 'verification rejected', now });

    if (decision === 'APPROVE') {
      const user = await authRepository.findAuthUserById(tx, doctor.userId);
      if (!user.roles.some((r) => r.role.name === 'DOCTOR')) {
        const doctorRole = await authRepository.findRoleByName(tx, 'DOCTOR');
        await authRepository.addUserRole(tx, { userId: doctor.userId, roleId: doctorRole.id });
        await auditRepository.createAuditLog(tx, { actorUserId: reviewerUserId, action: 'UPDATE', entityType: 'UserRole', entityId: doctor.userId, newValues: { granted: 'DOCTOR', reason: 'doctor application approved' } });
      }
    }
    await auditRepository.createAuditLog(tx, {
      actorUserId: reviewerUserId,
      action: 'VERIFY',
      entityType: 'VerificationRequest',
      entityId: request.id,
      oldValues: { status: request.status },
      newValues: { status: rule.request, doctorId, ...(decision === 'REJECT' ? { reason: notes.trim() } : {}) },
    });
    await notificationEvents.applicationDecided(tx, { decision, requestId: request.id, doctorId, doctorUserId: doctor.userId });
  });

  const profile = await doctorRepository.findApplicationById(prisma, doctorId);
  return presentApplicationForAdmin(profile);
}

/** The approved doctor's own profile for the doctor dashboard (route requires the DOCTOR role). */
export async function getMyDoctorProfile(auth) {
  const profile = await doctorRepository.findApplicationByUserId(prisma, auth.user.id);
  if (!profile) throw ApiError.notFound('Doctor profile not found');
  return presentApplication(profile);
}
