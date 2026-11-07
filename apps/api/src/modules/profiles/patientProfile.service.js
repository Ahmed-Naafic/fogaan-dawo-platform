import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';
import { getSignInMethods } from '../auth/google.service.js';
import { patientCompleteness } from './profile.completeness.js';
import { photoInfo } from './profilePhoto.service.js';
import * as profileRepository from './profile.repository.js';

/**
 * The signed-in patient's own profile. The patient is always `auth.user` — no id is ever taken from
 * the client. Editable: name, preferred language, date of birth, sex, address, emergency contact.
 * Read-only: email and phone (no verification flow yet), account status, roles, verification fields.
 */
export const PatientProfileErrorCode = Object.freeze({ notPatient: 'PATIENT_PROFILE_REQUIRED', nameLocked: 'NAME_LOCKED_BY_DOCTOR_PROFILE' });

/**
 * users.full_name is also a doctor's professional name. Once a doctor application is submitted, under
 * review or approved, the name is part of what the administrator verified, so it cannot be changed
 * from the patient profile (doctors see it read-only too).
 */
export const NAME_LOCKED_DOCTOR_STATUSES = Object.freeze(['PENDING', 'UNDER_REVIEW', 'VERIFIED']);

const dateOnly = (d) => (d ? d.toISOString().slice(0, 10) : null);

export function presentPatientProfile(user, { medicalHistoryCount = 0, signInMethods = null, roles = [] } = {}) {
  const p = user.patientProfile;
  const address = p.addresses[0] ?? null;
  const profile = {
    fullName: user.fullName,
    email: user.email,
    phone: user.phone,
    emailVerified: Boolean(user.emailVerifiedAt),
    phoneVerified: Boolean(user.phoneVerifiedAt),
    preferredLanguage: user.preferredLanguage,
    dateOfBirth: dateOnly(p.dateOfBirth),
    sex: p.sex ?? null,
    address: address ? { city: address.city, addressLine: address.addressLine ?? null } : null,
    emergencyContact: p.emergencyName || p.emergencyPhone ? { name: p.emergencyName ?? '', relationship: p.emergencyRelationship ?? '', phone: p.emergencyPhone ?? '' } : null,
    photo: photoInfo(user),
    medicalHistoryCount,
    account: { createdAt: user.createdAt.toISOString(), status: user.status, roles, signInMethods },
  };
  return { ...profile, nameLocked: NAME_LOCKED_DOCTOR_STATUSES.includes(user.doctorProfile?.verificationStatus), completeness: patientCompleteness(profile) };
}

async function loadUser(client, auth) {
  const user = await profileRepository.findPatientProfileByUserId(client, auth.user.id);
  if (!user?.patientProfile) throw ApiError.forbidden('A patient profile is required', undefined, PatientProfileErrorCode.notPatient);
  return user;
}

export async function getMyPatientProfile(auth) {
  const user = await loadUser(prisma, auth);
  const [medicalHistoryCount, signInMethods] = await Promise.all([
    profileRepository.countActiveHistoryEntries(prisma, user.patientProfile.id),
    getSignInMethods(auth),
  ]);
  return presentPatientProfile(user, { medicalHistoryCount, signInMethods, roles: auth.roles });
}

/** Applies only the validated, whitelisted fields present in `input` (PATCH semantics). */
export async function updateMyPatientProfile(auth, input) {
  await withTransaction(async (tx) => {
    const user = await loadUser(tx, auth);
    const patientId = user.patientProfile.id;
    await lockRow(tx, 'patient_profiles', patientId);

    const userData = {};
    if ('fullName' in input && input.fullName !== user.fullName) {
      const doctor = await profileRepository.findDoctorStatusByUserId(tx, user.id);
      if (doctor && NAME_LOCKED_DOCTOR_STATUSES.includes(doctor.verificationStatus)) {
        throw ApiError.conflict('Your name is part of your verified doctor profile and cannot be changed here', { status: doctor.verificationStatus }, PatientProfileErrorCode.nameLocked);
      }
      userData.fullName = input.fullName;
    }
    if ('preferredLanguage' in input) userData.preferredLanguage = input.preferredLanguage;
    if (Object.keys(userData).length) await profileRepository.updateUser(tx, user.id, userData);

    const patientData = {};
    if ('dateOfBirth' in input) patientData.dateOfBirth = input.dateOfBirth ? new Date(`${input.dateOfBirth}T00:00:00Z`) : null;
    if ('sex' in input) patientData.sex = input.sex;
    if ('emergencyContact' in input) {
      const c = input.emergencyContact;
      Object.assign(patientData, { emergencyName: c?.name ?? null, emergencyRelationship: c?.relationship ?? null, emergencyPhone: c?.phone ?? null });
    }
    if (Object.keys(patientData).length) await profileRepository.updatePatientProfile(tx, patientId, patientData);

    if ('address' in input) {
      const current = await profileRepository.findDefaultAddress(tx, patientId);
      if (input.address === null) {
        if (current) await profileRepository.deleteAddress(tx, current.id);
      } else {
        const data = { city: input.address.city, addressLine: input.address.addressLine ?? null };
        if (current) await profileRepository.updateAddress(tx, current.id, data);
        else await profileRepository.createAddress(tx, { patientId, ...data, isDefault: true });
      }
    }

    // Field names only — personal values are not copied into the audit log.
    await auditRepository.createAuditLog(tx, { actorUserId: user.id, action: 'UPDATE', entityType: 'PatientProfile', entityId: patientId, newValues: { fields: Object.keys(input).sort() } });
  });
  return getMyPatientProfile(auth);
}
