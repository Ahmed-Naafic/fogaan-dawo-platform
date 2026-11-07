import { z } from 'zod';

/** Strict schemas: unknown fields are rejected (no price, status, patient or doctor id from the client). */

const uuid = z.string().uuid();
const optionalText = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());

export const bookSchema = z.object({ slotId: uuid, reason: optionalText(500) }).strict();

export const listQuerySchema = z.object({ scope: z.enum(['upcoming', 'past']).default('upcoming') }).strict();

export const appointmentParamsSchema = z.object({ appointmentId: uuid }).strict();

export const cancelSchema = z.object({ reason: optionalText(500) }).strict();

/** Doctors must say why they cancel (shown to the patient). */
export const doctorCancelSchema = z.object({ reason: z.string().trim().min(10, 'Give a reason of at least 10 characters').max(500) }).strict();

export const rescheduleSchema = z.object({ slotId: uuid }).strict();
