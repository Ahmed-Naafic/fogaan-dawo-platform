import { z } from 'zod';
import { rangeFields } from '../finance/finance.validation.js';

/** Strict query/body schemas for the admin console (patients, appointments, reports, audit logs). */

const optionalBlank = (schema) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());
const page = {
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
};
const search = optionalBlank(z.string().trim().max(100));

/* ------------------------------------------------------------ patients */

export const PATIENT_TABS = Object.freeze(['all', 'active', 'suspended']);
export const adminPatientListQuerySchema = z.object({ tab: z.enum(PATIENT_TABS).default('all'), q: search, ...page }).strict();
export const adminPatientParamsSchema = z.object({ patientId: z.uuid() }).strict();
/** A reason is required: it is kept in the audit log and on any cancelled appointment. */
export const suspendPatientSchema = z.object({ reason: z.string().trim().min(10, 'Give a reason of at least 10 characters').max(500) }).strict();
export const reactivatePatientSchema = z.object({ reason: optionalBlank(z.string().trim().max(500)) }).strict();

/* ------------------------------------------------------------ appointments */

export const APPOINTMENT_STATUSES = Object.freeze(['PENDING_PAYMENT', 'CONFIRMED', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'RESCHEDULED', 'NO_SHOW']);
export const adminAppointmentListQuerySchema = z.object({ ...rangeFields, status: optionalBlank(z.enum(APPOINTMENT_STATUSES)), q: search, ...page }).strict();
export const adminAppointmentParamsSchema = z.object({ appointmentId: z.uuid() }).strict();

/* ------------------------------------------------------------ reports */

export const reportQuerySchema = z.object(rangeFields).strict();

/* ------------------------------------------------------------ audit logs */

export const AUDIT_ACTIONS = Object.freeze(['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'VERIFY', 'SUSPEND', 'REFUND', 'RESCHEDULE', 'OTHER']);
export const adminAuditQuerySchema = z
  .object({
    ...rangeFields,
    action: optionalBlank(z.enum(AUDIT_ACTIONS)),
    entityType: optionalBlank(z.string().trim().max(100).regex(/^[A-Za-z]+$/)),
    actorUserId: optionalBlank(z.uuid()),
    q: search,
    ...page,
  })
  .strict();
