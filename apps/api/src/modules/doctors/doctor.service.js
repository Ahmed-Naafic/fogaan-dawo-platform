import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as appointmentRepository from '../appointments/appointment.repository.js';
import * as auditRepository from '../audit/audit.repository.js';
import * as notificationEvents from '../notifications/notification.events.js';
import { cancelRemindersForAppointment } from '../notifications/reminder.service.js';
import { createRefundRequest } from '../refunds/refund.service.js';
import { SUSPENSION_CANCELLABLE_STATUSES } from './doctor.constants.js';
import * as doctorRepository from './doctor.repository.js';
import { revokeDoctorPrivileges } from './doctorPrivileges.service.js';

/** Search shows verified, active doctors only. */
export function searchDoctors(filters = {}, client = prisma) {
  return doctorRepository.searchDoctors(client, filters);
}

/**
 * Publishes availability slots. Only verified, active doctors may publish; overlapping slots are
 * rejected by the availability_slots_no_overlap exclusion constraint.
 */
export async function publishSlots({ doctorId, slots, sourceRuleId = null }) {
  return withTransaction(async (tx) => {
    if (!(await doctorRepository.findBookableDoctor(tx, doctorId))) throw ApiError.forbidden('Only verified, active doctors can publish availability');
    return doctorRepository.createSlots(
      tx,
      slots.map((s) => ({ doctorId, sourceRuleId, startAtUtc: s.startAtUtc, endAtUtc: s.endAtUtc, timeZoneSnapshot: s.timeZone })),
    );
  });
}

const DECISION_FOR_STATUS = Object.freeze({ APPROVED: 'APPROVE', REJECTED: 'REJECT', UNDER_REVIEW: 'START_REVIEW' });

/**
 * Admin decision on a verification request. Delegates to the single decision path in
 * doctorVerification.service.js (self-review guard, status transitions, DOCTOR role grant on approval).
 */
export async function reviewVerification({ verificationRequestId, reviewerUserId, status, notes = null, now = new Date() }) {
  const request = await doctorRepository.findVerificationRequestById(prisma, verificationRequestId);
  if (!request) throw ApiError.notFound('Verification request not found');
  const decision = DECISION_FOR_STATUS[status];
  if (!decision) throw ApiError.badRequest(`Unsupported review status ${status}`);
  const { decideApplication } = await import('./doctorVerification.service.js');
  return decideApplication({ doctorId: request.doctorId, reviewerUserId, decision, notes, now });
}

/**
 * Uploads a new document version. Earlier versions are preserved (is_current = false, linked through
 * replaces_document_id). Replacing the MEDICAL_LICENSE of an already-VERIFIED doctor is critical: the
 * doctor returns to PENDING verification (hidden from search, cannot publish) and a new verification
 * request is opened. `allowedStatuses` (optional) restricts uploads to those verification statuses,
 * checked under the row lock.
 */
export async function addDocumentVersion({ doctorId, documentType, fileKey, fileName, mimeType, fileSize, sha256 = null, allowedStatuses = null, actorUserId = null, licenceDetails = null, now = new Date() }) {
  if (licenceDetails && documentType !== 'MEDICAL_LICENSE') throw new Error('licenceDetails only apply to a MEDICAL_LICENSE upload');
  return withTransaction(async (tx) => {
    if (!(await lockRow(tx, 'doctor_profiles', doctorId))) throw ApiError.notFound('Doctor not found');
    const doctor = await doctorRepository.findDoctorById(tx, doctorId);
    if (allowedStatuses && !allowedStatuses.includes(doctor.verificationStatus)) {
      throw ApiError.conflict('Documents cannot be changed in the current application status', { status: doctor.verificationStatus }, 'APPLICATION_LOCKED');
    }
    const current = await doctorRepository.findCurrentDocument(tx, doctorId, documentType);
    const latestVersion = await doctorRepository.findLatestDocumentVersion(tx, doctorId);
    if (current) await doctorRepository.markDocumentNotCurrent(tx, current.id);

    const document = await doctorRepository.createDocument(tx, {
      doctorId,
      documentType,
      fileKey,
      fileName,
      mimeType,
      fileSize,
      sha256,
      versionNumber: latestVersion + 1,
      replacesDocumentId: current?.id ?? null,
    });

    // New licence number / country travel with the new licence file (doctor profile "replace licence").
    if (licenceDetails) await doctorRepository.updateDoctor(tx, doctorId, { licenceNumber: licenceDetails.licenceNumber, licenceCountry: licenceDetails.licenceCountry });

    let verificationRequest = null;
    let privileges = null;
    // A verified doctor changing licence details always re-verifies, even if no earlier licence file exists.
    if ((current || licenceDetails) && documentType === 'MEDICAL_LICENSE' && doctor.verificationStatus === 'VERIFIED') {
      // Critical licence replacement → re-verification (approved rule): PENDING + new request, DOCTOR role
      // removed (PATIENT kept), open slots withdrawn — all in this transaction, or none of it.
      await doctorRepository.updateDoctor(tx, doctorId, { verificationStatus: 'PENDING', verifiedAt: null });
      verificationRequest = await doctorRepository.createVerificationRequest(tx, { doctorId, notes: 'Medical licence replaced — re-verification required' });
      privileges = await revokeDoctorPrivileges(tx, { doctorId, actorUserId, reason: 'medical licence replaced — re-verification required', now });
      await auditRepository.createAuditLog(tx, {
        actorUserId,
        action: 'CREATE',
        entityType: 'VerificationRequest',
        entityId: verificationRequest.id,
        oldValues: { verificationStatus: 'VERIFIED' },
        newValues: { verificationStatus: 'PENDING', doctorId, reason: 'medical licence replaced', replacedDocumentId: current?.id ?? null, newDocumentId: document.id, licenceDetailsChanged: Boolean(licenceDetails), ...privileges },
      });
    }
    return { document, verificationRequest, privileges };
  });
}

/**
 * Suspends a doctor. In one transaction: account SUSPENDED; every future appointment still pending,
 * confirmed or waiting is CANCELLED (slot CANCELLED, status history); each paid one gets a full
 * refund request for its remaining balance; patients are notified; the action is audited.
 */
export async function suspendDoctor({ doctorId, adminUserId, reason, now = new Date() }) {
  return withTransaction(
    async (tx) => {
      if (!(await lockRow(tx, 'doctor_profiles', doctorId))) throw ApiError.notFound('Doctor not found');
      const doctor = await doctorRepository.findDoctorById(tx, doctorId);
      if (doctor.accountStatus === 'SUSPENDED') throw ApiError.conflict('Doctor is already suspended', undefined, 'DOCTOR_ALREADY_SUSPENDED');
      await doctorRepository.updateDoctor(tx, doctorId, { accountStatus: 'SUSPENDED' });

      const appointments = await appointmentRepository.findFutureAppointmentsForDoctor(tx, { doctorId, after: now, statuses: SUSPENSION_CANCELLABLE_STATUSES });
      const refunds = [];
      for (const appointment of appointments) {
        await lockRow(tx, 'appointments', appointment.id);
        await appointmentRepository.updateAppointment(tx, appointment.id, {
          status: 'CANCELLED',
          cancelledAt: now,
          cancellationReason: `Doctor suspended: ${reason}`,
          holdExpiresAt: null,
        });
        await appointmentRepository.recordStatusChange(tx, {
          appointmentId: appointment.id,
          fromStatus: appointment.status,
          toStatus: 'CANCELLED',
          reason: 'Doctor suspended',
          changedBy: adminUserId,
        });
        await lockRow(tx, 'availability_slots', appointment.slotId);
        await appointmentRepository.setSlotStatus(tx, appointment.slotId, 'CANCELLED');

        await cancelRemindersForAppointment(tx, appointment.id);
        const paid = appointment.payment?.status === 'SUCCEEDED';
        let refund = null;
        if (paid) refunds.push((refund = await createRefundRequest(tx, { appointmentId: appointment.id, reason: 'Doctor suspended — full refund' })));
        if (refund) await notificationEvents.refundRequested(tx, refund);
        await notificationEvents.appointmentCancelled(tx, { appointmentId: appointment.id, by: 'SYSTEM', wasConfirmed: appointment.status === 'CONFIRMED', refund: Boolean(refund) });
      }

      await auditRepository.createAuditLog(tx, {
        actorUserId: adminUserId,
        action: 'SUSPEND',
        entityType: 'DoctorProfile',
        entityId: doctorId,
        oldValues: { accountStatus: doctor.accountStatus },
        newValues: { accountStatus: 'SUSPENDED', reason, cancelledAppointments: appointments.length, refundRequests: refunds.length },
      });
      await notificationEvents.doctorSuspended(tx, { doctorId, doctorUserId: doctor.userId, at: now });
      return { cancelledAppointmentIds: appointments.map((a) => a.id), refunds };
    },
    { timeout: 60_000 },
  );
}
