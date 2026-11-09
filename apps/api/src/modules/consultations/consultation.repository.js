/** Data access for consultations, their events and notes. */

/** Data access: find consultation by id (consultation.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findConsultationById = (client, id) => client.consultation.findUnique({ where: { id } });

/** Data access: find consultation with doctor (consultation.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findConsultationWithDoctor = (client, id) => client.consultation.findUnique({ where: { id }, include: { doctor: true } });

/** Data access: count consultations between (consultation.count: count of matching rows). `client` is the Prisma client or a transaction. */
export const countConsultationsBetween = (client, { doctorId, patientId }) => client.consultation.count({ where: { doctorId, patientId } });

/** Data access: update consultation (consultation.update: updates a row). `client` is the Prisma client or a transaction. */
export const updateConsultation = (client, id, data) => client.consultation.update({ where: { id }, data });

/** Data access: find note by consultation id (consultationNote.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findNoteByConsultationId = (client, consultationId) => client.consultationNote.findUnique({ where: { consultationId } });

/** Data access: upsert note (consultationNote.upsert: inserts or updates a row). `client` is the Prisma client or a transaction. */
export const upsertNote = (client, consultationId, { create, update }) =>
  client.consultationNote.upsert({ where: { consultationId }, create: { consultationId, ...create }, update });

/* ------------------------------------------------------------ calls (Phase 7) */

const PARTY = { select: { id: true, userId: true, user: { select: { fullName: true, avatarUpdatedAt: true } } } };

/** An appointment with what a call needs: both parties' user ids and names, and its consultation. */
export const findCallAppointment = (client, appointmentId) =>
  client.appointment.findUnique({ where: { id: appointmentId }, include: { patient: PARTY, doctor: PARTY, consultation: true } });

/** Data access: find consultation by appointment id (consultation.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findConsultationByAppointmentId = (client, appointmentId) => client.consultation.findUnique({ where: { appointmentId } });

/** Data access: create consultation (consultation.create: inserts a row). `client` is the Prisma client or a transaction. */
export const createConsultation = (client, { appointmentId, patientId, doctorId }) => client.consultation.create({ data: { appointmentId, patientId, doctorId } });

/** Data access: add event (consultationEvent.create: inserts a row). `client` is the Prisma client or a transaction. */
export const addEvent = (client, { consultationId, eventType, participantRole, occurredAt, metadata }) =>
  client.consultationEvent.create({ data: { consultationId, eventType, participantRole, ...(occurredAt ? { occurredAt } : {}), ...(metadata ? { metadata } : {}) } });

/** Data access: list events (consultationEvent.findMany: matching rows). `client` is the Prisma client or a transaction. */
export const listEvents = (client, consultationId) =>
  client.consultationEvent.findMany({ where: { consultationId }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], select: { id: true, eventType: true, participantRole: true, occurredAt: true } });

/** Minimal row for the signaling hub: status and the two participants' user ids. */
export const findSignalingContext = (client, consultationId) =>
  client.consultation.findUnique({
    where: { id: consultationId },
    select: { id: true, status: true, patient: { select: { userId: true } }, doctor: { select: { userId: true } } },
  });
