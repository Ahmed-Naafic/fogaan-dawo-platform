import { BOOKABLE_DOCTOR_WHERE } from '../doctors/doctor.constants.js';

/**
 * Data access for profiles. Never selects password_hash. `avatarKey` (a private storage key) is only
 * read by the photo service to stream or replace the file; it is never returned to clients.
 */

const PATIENT_PROFILE_SELECT = Object.freeze({
  id: true,
  fullName: true,
  email: true,
  phone: true,
  status: true,
  preferredLanguage: true,
  timeZone: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  createdAt: true,
  avatarUpdatedAt: true,
  doctorProfile: { select: { verificationStatus: true } },
  patientProfile: {
    select: {
      id: true,
      dateOfBirth: true,
      sex: true,
      emergencyName: true,
      emergencyPhone: true,
      emergencyRelationship: true,
      addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }], take: 1, select: { id: true, city: true, addressLine: true } },
    },
  },
});

export const findPatientProfileByUserId = (client, userId) => client.user.findUnique({ where: { id: userId }, select: PATIENT_PROFILE_SELECT });

export const findDoctorStatusByUserId = (client, userId) => client.doctorProfile.findUnique({ where: { userId }, select: { id: true, verificationStatus: true } });

export const updateUser = (client, userId, data) => client.user.update({ where: { id: userId }, data, select: { id: true } });

export const updatePatientProfile = (client, patientId, data) => client.patientProfile.update({ where: { id: patientId }, data, select: { id: true } });

export const findDefaultAddress = (client, patientId) =>
  client.patientAddress.findFirst({ where: { patientId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });

export const createAddress = (client, data) => client.patientAddress.create({ data, select: { id: true } });

export const updateAddress = (client, id, data) => client.patientAddress.update({ where: { id }, data, select: { id: true } });

/** Address is contact data, not a medical record; removing it is a plain delete of the patient's own row. */
export const deleteAddress = (client, id) => client.patientAddress.delete({ where: { id } });

export const countActiveHistoryEntries = (client, patientId) =>
  client.medicalHistoryEntry.count({ where: { history: { patientId }, archivedAt: null } });

/* ------------------------------------------------------------------ photos */

export const findAvatar = (client, userId) =>
  client.user.findUnique({ where: { id: userId }, select: { id: true, avatarKey: true, avatarUpdatedAt: true } });

export const setAvatar = (client, userId, { avatarKey, avatarUpdatedAt }) =>
  client.user.update({ where: { id: userId }, data: { avatarKey, avatarUpdatedAt }, select: { id: true, avatarUpdatedAt: true } });

/** Public doctor photo: only for a doctor who is listed publicly (verified, active, user active). */
export const findPublicDoctorAvatar = (client, doctorId) =>
  client.doctorProfile.findFirst({
    where: { id: doctorId, ...BOOKABLE_DOCTOR_WHERE },
    select: { id: true, user: { select: { avatarKey: true, avatarUpdatedAt: true } } },
  });
