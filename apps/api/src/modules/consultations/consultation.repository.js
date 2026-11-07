/** Data access for consultations, their events and notes. */

export const findConsultationById = (client, id) => client.consultation.findUnique({ where: { id } });

export const findConsultationWithDoctor = (client, id) => client.consultation.findUnique({ where: { id }, include: { doctor: true } });

export const countConsultationsBetween = (client, { doctorId, patientId }) => client.consultation.count({ where: { doctorId, patientId } });

export const updateConsultation = (client, id, data) => client.consultation.update({ where: { id }, data });

export const findNoteByConsultationId = (client, consultationId) => client.consultationNote.findUnique({ where: { consultationId } });

export const upsertNote = (client, consultationId, { create, update }) =>
  client.consultationNote.upsert({ where: { consultationId }, create: { consultationId, ...create }, update });

/* ------------------------------------------------------------ calls (Phase 7) */

const PARTY = { select: { id: true, userId: true, user: { select: { fullName: true, avatarUpdatedAt: true } } } };

/** An appointment with what a call needs: both parties' user ids and names, and its consultation. */
export const findCallAppointment = (client, appointmentId) =>
  client.appointment.findUnique({ where: { id: appointmentId }, include: { patient: PARTY, doctor: PARTY, consultation: true } });

export const findConsultationByAppointmentId = (client, appointmentId) => client.consultation.findUnique({ where: { appointmentId } });

export const createConsultation = (client, { appointmentId, patientId, doctorId }) => client.consultation.create({ data: { appointmentId, patientId, doctorId } });

export const addEvent = (client, { consultationId, eventType, participantRole, occurredAt, metadata }) =>
  client.consultationEvent.create({ data: { consultationId, eventType, participantRole, ...(occurredAt ? { occurredAt } : {}), ...(metadata ? { metadata } : {}) } });

export const listEvents = (client, consultationId) =>
  client.consultationEvent.findMany({ where: { consultationId }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], select: { id: true, eventType: true, participantRole: true, occurredAt: true } });

/** Minimal row for the signaling hub: status and the two participants' user ids. */
export const findSignalingContext = (client, consultationId) =>
  client.consultation.findUnique({
    where: { id: consultationId },
    select: { id: true, status: true, patient: { select: { userId: true } }, doctor: { select: { userId: true } } },
  });
