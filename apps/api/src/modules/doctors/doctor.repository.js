import { BOOKABLE_DOCTOR_WHERE } from './doctor.constants.js';

/** Data access for doctor profiles, documents, verification and published slots. */

export const findDoctorById = (client, id) => client.doctorProfile.findUnique({ where: { id } });

export const findDoctorByUserId = (client, userId) => client.doctorProfile.findUnique({ where: { userId } });

export const findBookableDoctor = (client, doctorId) => client.doctorProfile.findFirst({ where: { id: doctorId, ...BOOKABLE_DOCTOR_WHERE } });

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

export const createSlots = (client, rows) => client.availabilitySlot.createManyAndReturn({ data: rows });

export const findCurrentDocument = (client, doctorId, documentType) =>
  client.doctorDocument.findFirst({ where: { doctorId, documentType, isCurrent: true } });

export async function findLatestDocumentVersion(client, doctorId) {
  const result = await client.doctorDocument.aggregate({ where: { doctorId }, _max: { versionNumber: true } });
  return result._max.versionNumber ?? 0;
}

export const markDocumentNotCurrent = (client, id) => client.doctorDocument.update({ where: { id }, data: { isCurrent: false } });

export const createDocument = (client, data) => client.doctorDocument.create({ data });

export const findVerificationRequestById = (client, id) => client.verificationRequest.findUnique({ where: { id } });

export const createVerificationRequest = (client, data) => client.verificationRequest.create({ data });

export const updateVerificationRequest = (client, id, data) => client.verificationRequest.update({ where: { id }, data });

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

export const findApplicationByUserId = (client, userId) => client.doctorProfile.findUnique({ where: { userId }, include: APPLICATION_INCLUDE });

export const findApplicationById = (client, id) => client.doctorProfile.findUnique({ where: { id }, include: APPLICATION_INCLUDE });

export const createDoctorProfile = (client, data) => client.doctorProfile.create({ data });

/** Replaces the applicant's language list (only ever called on their own draft/rejected application). */
export async function replaceDoctorLanguages(client, doctorId, languages) {
  await client.doctorLanguage.deleteMany({ where: { doctorId } });
  if (languages.length) await client.doctorLanguage.createMany({ data: languages.map((language) => ({ doctorId, language })) });
}

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

export async function countApplicationsByStatus(client) {
  const rows = await client.doctorProfile.groupBy({ by: ['verificationStatus'], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.verificationStatus, r._count._all]));
}

/** Includes the private storage key — for the file download path only, never returned to clients. */
export const findDocumentForDownload = (client, { doctorId, documentId }) =>
  client.doctorDocument.findFirst({ where: { id: documentId, doctorId }, select: { id: true, fileKey: true, fileName: true, mimeType: true, fileSize: true } });

export const findSpecialtyById = (client, id) => client.specialty.findUnique({ where: { id } });

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
  verifiedAt: true,
  createdAt: true,
  specialty: { select: { id: true, nameEn: true, nameSo: true } },
  languages: { select: { language: true } },
  // avatarUpdatedAt only tells whether a photo exists (for the versioned public URL); never the key.
  user: { select: { fullName: true, timeZone: true, avatarUpdatedAt: true } },
});

export const findPublicDoctors = (client, where, take) =>
  client.doctorProfile.findMany({ where: { ...where, ...BOOKABLE_DOCTOR_WHERE }, select: PUBLIC_DOCTOR_SELECT, orderBy: { createdAt: 'asc' }, take });

export const findPublicDoctor = (client, id) => client.doctorProfile.findFirst({ where: { id, ...BOOKABLE_DOCTOR_WHERE }, select: PUBLIC_DOCTOR_SELECT });

export const ratingsFor = (client, doctorIds) =>
  doctorIds.length ? client.review.groupBy({ by: ['doctorId'], where: { doctorId: { in: doctorIds } }, _avg: { rating: true }, _count: { _all: true } }) : [];

export const nextAvailableFor = (client, doctorIds, now) =>
  doctorIds.length
    ? client.availabilitySlot.groupBy({ by: ['doctorId'], where: { doctorId: { in: doctorIds }, status: 'AVAILABLE', startAtUtc: { gt: now } }, _min: { startAtUtc: true } })
    : [];

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
  verifiedAt: true,
  createdAt: true,
  specialty: { select: { id: true, nameEn: true, nameSo: true } },
  languages: { select: { language: true } },
  user: { select: { fullName: true, email: true, phone: true, status: true } },
});

const adminSearch = (q) =>
  q ? { OR: [{ user: { fullName: { contains: q, mode: 'insensitive' } } }, { user: { email: { contains: q, mode: 'insensitive' } } }, { licenceNumber: { contains: q, mode: 'insensitive' } }] } : {};

export const listDoctorsForAdmin = (client, { tab, q, skip, take }) =>
  client.doctorProfile.findMany({ where: { ...ADMIN_DOCTOR_TABS[tab], ...adminSearch(q) }, select: ADMIN_DOCTOR_SELECT, orderBy: { createdAt: 'desc' }, skip, take });

export const countDoctorsForAdmin = (client, { tab, q }) => client.doctorProfile.count({ where: { ...ADMIN_DOCTOR_TABS[tab], ...adminSearch(q) } });

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
