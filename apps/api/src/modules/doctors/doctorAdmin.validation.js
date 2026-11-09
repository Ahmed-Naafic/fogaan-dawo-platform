import { z } from 'zod';

const optionalBlank = (schema) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

export const ADMIN_DOCTOR_TAB_NAMES = Object.freeze(['all', 'verified', 'pending', 'rejected', 'suspended']);

export const adminDoctorListQuerySchema = z
  .object({
    tab: z.enum(ADMIN_DOCTOR_TAB_NAMES).default('all'),
    q: optionalBlank(z.string().trim().max(100)),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const adminDoctorParamsSchema = z.object({ doctorId: z.string().uuid() }).strict();

/**
 * Requirement 1 ("Admin can edit"): an administrator corrects a doctor's profile. Same bounds as the
 * doctor's own form; the fee change applies to new bookings only (appointments keep their snapshot).
 * Licence number/country are not editable here (they belong to the verification documents).
 */
export const adminDoctorUpdateSchema = z
  .object({
    fullName: z.string().trim().min(3).max(160),
    specialtyId: z.string().uuid(),
    country: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().min(2).max(100).nullable()),
    timeZone: z.string().trim().min(3).max(64),
    yearsExperience: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().int().min(0).max(60).nullable()),
    consultationFee: z.coerce.number().min(5, 'Consultation fee must be at least USD 5').max(200, 'Consultation fee must be at most USD 200').refine((v) => Math.round(v * 100) / 100 === v, 'Use at most 2 decimal places'),
    bio: z.string().trim().min(50, 'Biography must be at least 50 characters').max(2000),
    languages: z.array(z.enum(['so', 'en', 'ar', 'sw', 'am', 'om', 'fr', 'it'])).min(1).max(8).refine((l) => new Set(l).size === l.length, 'Languages must be unique'),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/** A reason is required: it is shown in the audit log and on cancelled appointments. */
export const suspendDoctorSchema = z
  .object({ reason: z.string().trim().min(10, 'Give a reason of at least 10 characters').max(500) })
  .strict();
