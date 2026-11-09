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

/** Data access: find patient profile by user id (user.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findPatientProfileByUserId = (client, userId) => client.user.findUnique({ where: { id: userId }, select: PATIENT_PROFILE_SELECT });

/** Data access: find doctor status by user id (doctorProfile.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findDoctorStatusByUserId = (client, userId) => client.doctorProfile.findUnique({ where: { userId }, select: { id: true, verificationStatus: true } });

/** Data access: update user (user.update: updates a row). `client` is the Prisma client or a transaction. */
export const updateUser = (client, userId, data) => client.user.update({ where: { id: userId }, data, select: { id: true } });

/** Data access: update patient profile (patientProfile.update: updates a row). `client` is the Prisma client or a transaction. */
export const updatePatientProfile = (client, patientId, data) => client.patientProfile.update({ where: { id: patientId }, data, select: { id: true } });

/** Data access: find default address (patientAddress.findFirst: first matching row). `client` is the Prisma client or a transaction. */
export const findDefaultAddress = (client, patientId) =>
  client.patientAddress.findFirst({ where: { patientId }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });

/** Data access: create address (patientAddress.create: inserts a row). `client` is the Prisma client or a transaction. */
export const createAddress = (client, data) => client.patientAddress.create({ data, select: { id: true } });

/** Data access: update address (patientAddress.update: updates a row). `client` is the Prisma client or a transaction. */
export const updateAddress = (client, id, data) => client.patientAddress.update({ where: { id }, data, select: { id: true } });

/** Address is contact data, not a medical record; removing it is a plain delete of the patient's own row. */
export const deleteAddress = (client, id) => client.patientAddress.delete({ where: { id } });

/** Data access: count active history entries (medicalHistoryEntry.count: count of matching rows). `client` is the Prisma client or a transaction. */
export const countActiveHistoryEntries = (client, patientId) =>
  client.medicalHistoryEntry.count({ where: { history: { patientId }, archivedAt: null } });

/* ------------------------------------------------------------------ photos */

/** Data access: find avatar (user.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findAvatar = (client, userId) =>
  client.user.findUnique({ where: { id: userId }, select: { id: true, avatarKey: true, avatarUpdatedAt: true } });

/** Data access: set avatar (user.update: updates a row). `client` is the Prisma client or a transaction. */
export const setAvatar = (client, userId, { avatarKey, avatarUpdatedAt }) =>
  client.user.update({ where: { id: userId }, data: { avatarKey, avatarUpdatedAt }, select: { id: true, avatarUpdatedAt: true } });

/** Public doctor photo: only for a doctor who is listed publicly (verified, active, user active). */
export const findPublicDoctorAvatar = (client, doctorId) =>
  client.doctorProfile.findFirst({
    where: { id: doctorId, ...BOOKABLE_DOCTOR_WHERE },
    select: { id: true, user: { select: { avatarKey: true, avatarUpdatedAt: true } } },
  });
