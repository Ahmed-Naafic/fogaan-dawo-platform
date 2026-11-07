import * as auditRepository from '../audit/audit.repository.js';
import * as notificationEvents from '../notifications/notification.events.js';
import * as authRepository from '../auth/auth.repository.js';
import { deactivateRules, findDoctorForSync, listActiveRules } from '../availability/availability.repository.js';
import { syncDoctorSlots } from '../availability/availability.service.js';

/**
 * Removes a doctor's DOCTOR privileges while keeping their PATIENT account (approved business rule:
 * re-verification). Must run inside the caller's transaction, AFTER the doctor row is locked and the
 * doctor's verification status has been set to a non-verified value. In that same transaction it:
 *   1. deletes the DOCTOR user_roles row (PATIENT and every other role are untouched);
 *   2. deactivates the doctor's weekly availability rules (kept for history), so availability is never
 *      restored automatically — after a new approval the doctor must publish availability again;
 *   3. withdraws every open, unbooked future slot through the existing slot sync (held/booked slots and
 *      their appointments are never touched — the sync's own rules);
 *   4. writes one audit entry.
 * Existing DOCTOR sessions lose access on their next request: authenticate() re-checks the role.
 * Restoring the role is NOT done here — only admin approval (decideApplication) grants DOCTOR again.
 */
export async function revokeDoctorPrivileges(tx, { doctorId, actorUserId = null, reason, now = new Date() }) {
  const doctor = await findDoctorForSync(tx, doctorId);
  const doctorRole = await authRepository.findRoleByName(tx, 'DOCTOR');
  const { count: rolesRemoved } = await authRepository.removeUserRole(tx, { userId: doctor.userId, roleId: doctorRole.id });
  const activeRules = await listActiveRules(tx, doctorId);
  const { count: rulesDeactivated } = await deactivateRules(tx, doctorId, activeRules.map((r) => r.id), new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`));
  const slots = await syncDoctorSlots(tx, doctor, now);
  if (rolesRemoved > 0 || slots.removed > 0 || rulesDeactivated > 0) {
    await auditRepository.createAuditLog(tx, {
      actorUserId,
      action: 'UPDATE',
      entityType: 'UserRole',
      entityId: doctor.userId,
      oldValues: { roles: rolesRemoved > 0 ? ['DOCTOR'] : [] },
      newValues: { revoked: rolesRemoved > 0 ? 'DOCTOR' : null, reason, doctorId, verificationStatus: doctor.verificationStatus, slotsWithdrawn: slots.removed, availabilityRulesDeactivated: rulesDeactivated },
    });
  }
  if (rolesRemoved > 0) await notificationEvents.doctorAccessPaused(tx, { doctorId, doctorUserId: doctor.userId, at: now });
  return { doctorRoleRemoved: rolesRemoved > 0, slotsWithdrawn: slots.removed, availabilityRulesDeactivated: rulesDeactivated };
}
