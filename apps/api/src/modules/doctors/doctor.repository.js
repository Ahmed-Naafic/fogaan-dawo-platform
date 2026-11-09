import { BOOKABLE_DOCTOR_WHERE } from './doctor.constants.js';

/** Data access for doctor profiles, documents, verification and published slots. */

/** Data access: find doctor by id (doctorProfile.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findDoctorById = (client, id) => client.doctorProfile.findUnique({ where: { id } });

/** Data access: find doctor by user id (doctorProfile.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findDoctorByUserId = (client, userId) => client.doctorProfile.findUnique({ where: { userId } });

/** Data access: find bookable doctor (doctorProfile.findFirst: first matching row). `client` is the Prisma client or a transaction. */
export const findBookableDoctor = (client, doctorId) => client.doctorProfile.findFirst({ where: { id: doctorId, ...BOOKABLE_DOCTOR_WHERE } });

/** Data access: update doctor (doctorProfile.update: updates a row). `client` is the Prisma client or a transaction. */
export const updateDoctor = (client, id, data) => client.doctorProfile.update({ where: { id }, data });

/** Public search: verified, active doctors only, public fields only. */
export const searchDoctors = (client, { specialtyId, take = 20, skip = 0 } = {}) =>
  client.doctorProfile.findMany({
    where: { ...BOOKABLE_DOCTOR_WHERE, ...(specialtyId ? { specialtyId } : {}) },
    select: {
      id: true,
      consultationFee: true,
      currency: true,
      bio: true,
      yearsExperience: true,
      specialty: { select: { id: true, nameEn: true, nameSo: true } },
      languages: { select: { language: true } },
      user: { select: { fullName: true } },
    },
    orderBy: { createdAt: 'asc' },
    take,
    skip,
  });

/** Data access: create slots (availabilitySlot.createManyAndReturn: createManyAndReturn). `client` is the Prisma client or a transaction. */
export const createSlots = (client, rows) => client.availabilitySlot.createManyAndReturn({ data: rows });

/** Data access: find current document (doctorDocument.findFirst: first matching row). `client` is the Prisma client or a transaction. */
export const findCurrentDocument = (client, doctorId, documentType) =>
  client.doctorDocument.findFirst({ where: { doctorId, documentType, isCurrent: true } });

/** Data access: find latest document version (doctorDocument.aggregate: aggregate values). `client` is the Prisma client or a transaction. */
export async function findLatestDocumentVersion(client, doctorId) {
  const result = await client.doctorDocument.aggregate({ where: { doctorId }, _max: { versionNumber: true } });
  return result._max.versionNumber ?? 0;
}

/** Data access: mark document not current (doctorDocument.update: updates a row). `client` is the Prisma client or a transaction. */
export const markDocumentNotCurrent = (client, id) => client.doctorDocument.update({ where: { id }, data: { isCurrent: false } });

/** Data access: create document (doctorDocument.create: inserts a row). `client` is the Prisma client or a transaction. */
export const createDocument = (client, data) => client.doctorDocument.create({ data });

/** Data access: find verification request by id (verificationRequest.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findVerificationRequestById = (client, id) => client.verificationRequest.findUnique({ where: { id } });

/** Data access: create verification request (verificationRequest.create: inserts a row). `client` is the Prisma client or a transaction. */
export const createVerificationRequest = (client, data) => client.verificationRequest.create({ data });

/** Data access: update verification request (verificationRequest.update: updates a row). `client` is the Prisma client or a transaction. */
export const updateVerificationRequest = (client, id, data) => client.verificationRequest.update({ where: { id }, data });

/** Data access: create verification review (verificationReview.create: inserts a row). `client` is the Prisma client or a transaction. */
export const createVerificationReview = (client, data) => client.verificationReview.create({ data });

/* ------------------------------------------------------ doctor applications */

/** Everything the application / review screens show. Never selects storage keys or password hashes. */
const APPLICATION_INCLUDE = Object.freeze({
  user: { select: { id: true, fullName: true, email: true, phone: true, status: true, avatarUpdatedAt: true } },
  specialty: { select: { id: true, nameEn: true, nameSo: true } },
  languages: { select: { language: true } },
  documents: {
    orderBy: { versionNumber: 'desc' },
    select: { id: true, documentType: true, fileName: true, mimeType: true, fileSize: true, versionNumber: true, isCurrent: true, uploadedAt: true, replacesDocumentId: true },
  },
  verificationRequests: {
    orderBy: { submittedAt: 'desc' },
    select: {
      id: true,
      status: true,
      submittedAt: true,
      resolvedAt: true,
      notes: true,
      reviews: { orderBy: { createdAt: 'asc' }, select: { id: true, status: true, notes: true, createdAt: true, reviewer: { select: { id: true, fullName: true } } } },
    },
  },
});

/** Data access: find application by user id (doctorProfile.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findApplicationByUserId = (client, userId) => client.doctorProfile.findUnique({ where: { userId }, include: APPLICATION_INCLUDE });

/** Data access: find application by id (doctorProfile.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findApplicationById = (client, id) => client.doctorProfile.findUnique({ where: { id }, include: APPLICATION_INCLUDE });

/** Data access: create doctor profile (doctorProfile.create: inserts a row). `client` is the Prisma client or a transaction. */
export const createDoctorProfile = (client, data) => client.doctorProfile.create({ data });

/** Replaces the applicant's language list (only ever called on their own draft/rejected application). */
export async function replaceDoctorLanguages(client, doctorId, languages) {
  await client.doctorLanguage.deleteMany({ where: { doctorId } });
  if (languages.length) await client.doctorLanguage.createMany({ data: languages.map((language) => ({ doctorId, language })) });
}

/** Data access: find latest verification request (verificationRequest.findFirst: first matching row). `client` is the Prisma client or a transaction. */
export const findLatestVerificationRequest = (client, doctorId) =>
  client.verificationRequest.findFirst({ where: { doctorId }, orderBy: { submittedAt: 'desc' } });

/** Admin queue: applications in the given doctor statuses, newest submission first. */
export const listApplicationsByStatus = (client, statuses) =>
  client.doctorProfile.findMany({
    where: { verificationStatus: { in: statuses } },
    select: {
      id: true,
      verificationStatus: true,
      user: { select: { id: true, fullName: true } },
      specialty: { select: { nameEn: true, nameSo: true } },
      verificationRequests: { orderBy: { submittedAt: 'desc' }, take: 1, select: { submittedAt: true, resolvedAt: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });

/** Data access: count applications by status (doctorProfile.groupBy: grouped counts/sums). `client` is the Prisma client or a transaction. */
export async function countApplicationsByStatus(client) {
  const rows = await client.doctorProfile.groupBy({ by: ['verificationStatus'], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.verificationStatus, r._count._all]));
}

/** Includes the private storage key — for the file download path only, never returned to clients. */
export const findDocumentForDownload = (client, { doctorId, documentId }) =>
  client.doctorDocument.findFirst({ where: { id: documentId, doctorId }, select: { id: true, fileKey: true, fileName: true, mimeType: true, fileSize: true } });

/** Data access: find specialty by id (specialty.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findSpecialtyById = (client, id) => client.specialty.findUnique({ where: { id } });

/** Data access: list active specialties (specialty.findMany: matching rows). `client` is the Prisma client or a transaction. */
export const listActiveSpecialties = (client) =>
  client.specialty.findMany({ where: { isActive: true }, orderBy: { nameEn: 'asc' }, select: { id: true, nameEn: true, nameSo: true, description: true } });

/* ---------------------------------------------------------------- public directory */

/** Public fields only — never licence numbers, documents, verification records or contact details. */
const PUBLIC_DOCTOR_SELECT = Object.freeze({
  id: true,
  consultationFee: true,
  currency: true,
  bio: true,
  qualifications: true,
  yearsExperience: true,
  country: true,
  verifiedAt: true,
  createdAt: true,
  specialty: { select: { id: true, nameEn: true, nameSo: true } },
  languages: { select: { language: true } },
  // avatarUpdatedAt only tells whether a photo exists (for the versioned public URL); never the key.
  user: { select: { fullName: true, timeZone: true, avatarUpdatedAt: true } },
});

/** Data access: find public doctors (doctorProfile.findMany: matching rows). `client` is the Prisma client or a transaction. */
export const findPublicDoctors = (client, where, take) =>
  client.doctorProfile.findMany({ where: { ...where, ...BOOKABLE_DOCTOR_WHERE }, select: PUBLIC_DOCTOR_SELECT, orderBy: { createdAt: 'asc' }, take });

/** Data access: find public doctor (doctorProfile.findFirst: first matching row). `client` is the Prisma client or a transaction. */
export const findPublicDoctor = (client, id) => client.doctorProfile.findFirst({ where: { id, ...BOOKABLE_DOCTOR_WHERE }, select: PUBLIC_DOCTOR_SELECT });

/** Data access: ratings for (review.groupBy: grouped counts/sums). `client` is the Prisma client or a transaction. */
export const ratingsFor = (client, doctorIds) =>
  doctorIds.length ? client.review.groupBy({ by: ['doctorId'], where: { doctorId: { in: doctorIds } }, _avg: { rating: true }, _count: { _all: true } }) : [];

/** Data access: next available for (availabilitySlot.groupBy: grouped counts/sums). `client` is the Prisma client or a transaction. */
export const nextAvailableFor = (client, doctorIds, now) =>
  doctorIds.length
    ? client.availabilitySlot.groupBy({ by: ['doctorId'], where: { doctorId: { in: doctorIds }, status: 'AVAILABLE', startAtUtc: { gt: now } }, _min: { startAtUtc: true } })
    : [];

/** Data access: find active schedule zone (availabilityRule.findFirst: first matching row). `client` is the Prisma client or a transaction. */
export const findActiveScheduleZone = (client, doctorId) =>
  client.availabilityRule.findFirst({ where: { doctorId, isActive: true }, select: { timeZone: true, slotDurationMinutes: true } });

/* ---------------------------------------------------------------- admin doctor management */

/** Admin list tabs. Drafts (NOT_SUBMITTED) are applicants, not doctors, and are never listed here. */
export const ADMIN_DOCTOR_TABS = Object.freeze({
  all: { verificationStatus: { not: 'NOT_SUBMITTED' } },
  verified: { verificationStatus: 'VERIFIED', accountStatus: 'ACTIVE' },
  pending: { verificationStatus: { in: ['PENDING', 'UNDER_REVIEW'] } },
  rejected: { verificationStatus: 'REJECTED' },
  suspended: { accountStatus: { not: 'ACTIVE' }, verificationStatus: { not: 'NOT_SUBMITTED' } },
});

const ADMIN_DOCTOR_SELECT = Object.freeze({
  id: true,
  userId: true,
  verificationStatus: true,
  accountStatus: true,
  consultationFee: true,
  currency: true,
  licenceNumber: true,
  licenceCountry: true,
  yearsExperience: true,
  country: true,
  bio: true,
  verifiedAt: true,
  createdAt: true,
  specialty: { select: { id: true, nameEn: true, nameSo: true } },
  languages: { select: { language: true } },
  user: { select: { fullName: true, email: true, phone: true, status: true, timeZone: true } },
});

const adminSearch = (q) =>
  q ? { OR: [{ user: { fullName: { contains: q, mode: 'insensitive' } } }, { user: { email: { contains: q, mode: 'insensitive' } } }, { licenceNumber: { contains: q, mode: 'insensitive' } }] } : {};

/** Data access: list doctors for admin (doctorProfile.findMany: matching rows). `client` is the Prisma client or a transaction. */
export const listDoctorsForAdmin = (client, { tab, q, skip, take }) =>
  client.doctorProfile.findMany({ where: { ...ADMIN_DOCTOR_TABS[tab], ...adminSearch(q) }, select: ADMIN_DOCTOR_SELECT, orderBy: { createdAt: 'desc' }, skip, take });

/** Data access: count doctors for admin (doctorProfile.count: count of matching rows). `client` is the Prisma client or a transaction. */
export const countDoctorsForAdmin = (client, { tab, q }) => client.doctorProfile.count({ where: { ...ADMIN_DOCTOR_TABS[tab], ...adminSearch(q) } });

/** Data access: find doctor for admin (doctorProfile.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findDoctorForAdmin = (client, id) => client.doctorProfile.findUnique({ where: { id }, select: ADMIN_DOCTOR_SELECT });

/** The most recent SUSPEND audit entry per doctor (reason, when, by whom) — suspension history lives in the audit log. */
export const latestSuspensions = (client, doctorIds) =>
  doctorIds.length
    ? client.auditLog.findMany({
        where: { action: 'SUSPEND', entityType: 'DoctorProfile', entityId: { in: doctorIds } },
        orderBy: { createdAt: 'desc' },
        select: { entityId: true, createdAt: true, newValues: true, actor: { select: { fullName: true } } },
      })
    : [];
