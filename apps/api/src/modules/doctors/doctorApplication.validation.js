import { z } from 'zod';
import { APPLICATION_DOCUMENT_TYPES, DOCTOR_LANGUAGES } from './doctorApplication.constants.js';

/** Applicant application form (PUT /api/v1/doctor-application). Mirrors the DB CHECK constraints. */
export const saveApplicationSchema = z
  .object({
    professionalName: z.string().trim().min(3, 'Professional name is required').max(160),
    specialtyId: z.uuid({ message: 'Choose a specialty' }),
    licenceNumber: z
      .string()
      .trim()
      .min(3, 'Licence number is required')
      .max(60)
      .regex(/^[A-Za-z0-9][A-Za-z0-9 ./-]*$/, 'Licence number may contain letters, digits, spaces, "-", "/" and "."'),
    licenceCountry: z
      .string()
      .trim()
      .min(2, 'Licence country is required')
      .max(100)
      .regex(/^[\p{L}][\p{L} .'-]*$/u, 'Licence country may contain letters only'),
    consultationFee: z.coerce
      .number({ message: 'Consultation fee must be a number' })
      .min(5, 'Consultation fee must be at least USD 5')
      .max(200, 'Consultation fee must be at most USD 200')
      .refine((v) => Math.round(v * 100) / 100 === v, 'Use at most 2 decimal places'),
    bio: z.string().trim().min(50, 'Biography must be at least 50 characters').max(2000),
    yearsExperience: z.coerce.number().int().min(0).max(60).optional(),
    languages: z
      .array(z.enum(DOCTOR_LANGUAGES), { message: 'Choose the languages you speak' })
      .min(1, 'Choose at least one language')
      .max(DOCTOR_LANGUAGES.length)
      .refine((l) => new Set(l).size === l.length, 'Languages must be unique'),
  })
  .strict();

export const documentTypeParamsSchema = z.object({ documentType: z.enum(APPLICATION_DOCUMENT_TYPES) }).strict();

export const documentIdParamsSchema = z.object({ documentId: z.uuid() }).strict();

/* ---------------------------------------------------------------- admin */

export const adminListQuerySchema = z.object({ tab: z.enum(['pending', 'verified', 'rejected']).default('pending') }).strict();

export const doctorIdParamsSchema = z.object({ doctorId: z.uuid() }).strict();

export const doctorDocumentParamsSchema = z.object({ doctorId: z.uuid(), documentId: z.uuid() }).strict();

export const approveSchema = z.object({ notes: z.string().trim().max(1000).optional() }).strict();

export const rejectSchema = z.object({ reason: z.string().trim().min(10, 'Give the applicant a reason of at least 10 characters').max(1000) }).strict();

export const startReviewSchema = z.object({}).strict();
