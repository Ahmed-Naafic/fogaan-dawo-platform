/** Data access for medical histories and their entries. Entries are never deleted (database trigger). */

/** Data access: ensure medical history (medicalHistory.upsert: inserts or updates a row). `client` is the Prisma client or a transaction. */
export const ensureMedicalHistory = (client, patientId) => client.medicalHistory.upsert({ where: { patientId }, update: {}, create: { patientId } });

/** Data access: create entry (medicalHistoryEntry.create: inserts a row). `client` is the Prisma client or a transaction. */
export const createEntry = (client, data) => client.medicalHistoryEntry.create({ data, select: ENTRY_SELECT });

/** Data access: find entry with history (medicalHistoryEntry.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findEntryWithHistory = (client, id) => client.medicalHistoryEntry.findUnique({ where: { id }, include: { history: true } });

/** Data access: update entry (medicalHistoryEntry.update: updates a row). `client` is the Prisma client or a transaction. */
export const updateEntry = (client, id, data) => client.medicalHistoryEntry.update({ where: { id }, data, select: ENTRY_SELECT });

/** What the history screens show. The author's name is included only to label doctor-written entries. */
export const ENTRY_SELECT = Object.freeze({
  id: true,
  entryType: true,
  title: true,
  description: true,
  recordedAt: true,
  source: true,
  createdByUserId: true,
  updatedByUserId: true,
  consultationId: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { fullName: true } },
});

/** One patient's entries (their own history only — the caller passes the authenticated patient's id). */
export const listEntriesForPatient = (client, patientId, { includeArchived }) =>
  client.medicalHistoryEntry.findMany({
    where: { history: { patientId }, ...(includeArchived ? {} : { archivedAt: null }) },
    select: ENTRY_SELECT,
    orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { entryType: 'asc' }, { createdAt: 'desc' }],
    take: 500,
  });

/** Data access: count active entries by type (medicalHistoryEntry.groupBy: grouped counts/sums). `client` is the Prisma client or a transaction. */
export const countActiveEntriesByType = (client, patientId) =>
  client.medicalHistoryEntry.groupBy({ by: ['entryType'], where: { history: { patientId }, archivedAt: null }, _count: { _all: true } });

/* ------------------------------------------------- doctor read access (assigned doctor only) */

/**
 * The appointment that authorises a doctor's read: it must be THIS doctor's appointment with THIS
 * patient and in one of `statuses`. Returns null otherwise (caller denies without revealing why).
 */
export const findEligibleAppointment = (client, { appointmentId, doctorId, patientId, statuses }) =>
  client.appointment.findFirst({
    where: { id: appointmentId, doctorId, patientId, status: { in: statuses } },
    select: { id: true, status: true, consultation: { select: { id: true, status: true } } },
  });

/** Only the clinical summary fields — never address, photo, email, phone or account data. */
export const findPatientClinicalSummary = (client, patientId) =>
  client.patientProfile.findUnique({
    where: { id: patientId },
    select: {
      id: true,
      dateOfBirth: true,
      sex: true,
      emergencyName: true,
      emergencyRelationship: true,
      emergencyPhone: true,
      // avatarUpdatedAt only versions the gated photo URL; the storage key is never read here.
      user: { select: { fullName: true, avatarUpdatedAt: true } },
    },
  });

/** Storage key of the patient's photo; read only to stream it to an authorised doctor. */
export const findPatientAvatar = (client, patientId) =>
  client.patientProfile.findUnique({ where: { id: patientId }, select: { user: { select: { avatarKey: true } } } });
