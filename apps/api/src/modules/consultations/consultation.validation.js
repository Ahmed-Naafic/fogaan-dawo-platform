import { z } from 'zod';

/** Strict schemas: ids come only from the URL; nothing about status, times or roles is accepted from clients. */
const uuid = z.string().uuid();

export const appointmentParamsSchema = z.object({ appointmentId: uuid }).strict();
export const consultationParamsSchema = z.object({ consultationId: uuid }).strict();
export const emptyBodySchema = z.object({}).strict();

const text = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(5000).nullable().optional());
export const noteSchema = z
  .object({ complaint: text, assessment: text, diagnosis: text, advice: text, shareComplaint: z.boolean().optional(), shareAssessment: z.boolean().optional(), shareDiagnosis: z.boolean().optional(), shareAdvice: z.boolean().optional() })
  .strict();
