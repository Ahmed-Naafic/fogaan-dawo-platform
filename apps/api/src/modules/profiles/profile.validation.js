import { z } from 'zod';
import { phoneSchema } from '../auth/auth.validation.js';
import { DOCTOR_LANGUAGES } from '../doctors/doctorApplication.constants.js';

/**
 * Profile request schemas. Every object is .strict(): unknown keys (role, status, verification fields,
 * email, phone, ids…) are rejected, so no mass assignment is possible. Email and phone are read-only
 * here: there is no verification flow to confirm a new address or number yet.
 */

const nullableText = (max, { min = 1 } = {}) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().min(min).max(max).nullable());

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

const realDate = (value) => {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

export const SEX_VALUES = Object.freeze(['FEMALE', 'MALE', 'PREFER_NOT_TO_SAY']);

export const patientProfileSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Full name is required').max(160),
    preferredLanguage: z.enum(['en', 'so']),
    dateOfBirth: z.preprocess(
      (v) => (v === '' ? null : v),
      isoDate
        .refine(realDate, 'Enter a valid date')
        .refine((v) => v >= '1900-01-01', 'Enter a valid date of birth')
        .refine((v) => v <= new Date().toISOString().slice(0, 10), 'Date of birth cannot be in the future')
        .nullable(),
    ),
    sex: z.preprocess((v) => (v === '' ? null : v), z.enum(SEX_VALUES).nullable()),
    address: z
      .object({
        city: z.string().trim().min(2, 'City is required').max(100),
        addressLine: nullableText(255).optional(),
      })
      .strict()
      .nullable(),
    emergencyContact: z
      .object({
        name: z.string().trim().min(2, 'Contact name is required').max(160),
        relationship: z.string().trim().min(2, 'Relationship is required').max(60),
        phone: phoneSchema,
      })
      .strict()
      .nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/** A verified doctor's freely editable professional details (same bounds as the application form). */
export const doctorProfileSchema = z
  .object({
    bio: z.string().trim().min(50, 'Biography must be at least 50 characters').max(2000),
    qualifications: nullableText(1000, { min: 2 }),
    yearsExperience: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().int().min(0).max(60).nullable()),
    country: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().min(2).max(100).nullable()),
    consultationFee: z.coerce
      .number({ message: 'Consultation fee must be a number' })
      .min(5, 'Consultation fee must be at least USD 5')
      .max(200, 'Consultation fee must be at most USD 200')
      .refine((v) => Math.round(v * 100) / 100 === v, 'Use at most 2 decimal places'),
    languages: z
      .array(z.enum(DOCTOR_LANGUAGES))
      .min(1, 'Choose at least one language')
      .max(DOCTOR_LANGUAGES.length)
      .refine((l) => new Set(l).size === l.length, 'Languages must be unique'),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/** Replacing the licence: new number/country travel with the file (query string; the body is the file). */
export const licenceReplaceQuerySchema = z
  .object({
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
    confirm: z.literal('true', { message: 'Confirm that you understand re-verification is required' }),
  })
  .strict();

export const publicDoctorPhotoParamsSchema = z.object({ doctorId: z.uuid() }).strict();

/* ------------------------------------------------------------ medical history */

export const HISTORY_ENTRY_TYPES = Object.freeze(['ALLERGY', 'CONDITION', 'MEDICATION', 'SURGERY', 'FAMILY_HISTORY', 'OTHER']);

const recordedAt = z.preprocess(
  (v) => (v === '' ? null : v),
  isoDate
    .refine(realDate, 'Enter a valid date')
    .refine((v) => v >= '1900-01-01', 'Enter a valid date')
    .refine((v) => v <= new Date().toISOString().slice(0, 10), 'The date cannot be in the future')
    .transform((v) => new Date(`${v}T00:00:00Z`))
    .nullable(),
);

const entryFields = {
  entryType: z.enum(HISTORY_ENTRY_TYPES),
  title: z.string().trim().min(2, 'Title is required').max(180),
  description: nullableText(4000),
  recordedAt,
};

export const historyEntryCreateSchema = z
  .object(entryFields)
  .partial({ description: true, recordedAt: true })
  .strict();

export const historyEntryUpdateSchema = z
  .object(entryFields)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const historyListQuerySchema = z.object({ includeArchived: z.enum(['true', 'false']).optional() }).strict();

export const entryIdParamsSchema = z.object({ entryId: z.uuid() }).strict();

export const emptyBodySchema = z.object({}).strict();

/* ------------------------------------------------------------ assigned doctor read access */

export const doctorPatientParamsSchema = z.object({ patientId: z.uuid() }).strict();

/** The appointment that authorises the read is always required (and audited). */
export const doctorPatientQuerySchema = z.object({ appointmentId: z.uuid({ message: 'appointmentId is required' }) }).strict();

/** Photo URLs also carry a cache-busting version. */
export const doctorPatientPhotoQuerySchema = z
  .object({ appointmentId: z.uuid({ message: 'appointmentId is required' }), v: z.string().regex(/^[0-9]{1,15}$/).optional() })
  .strict();
