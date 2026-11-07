import { z } from 'zod';
import { isValidTimeZone } from '../../utils/timezone.js';
import { MAX_SLOT_QUERY_DAYS } from '../availability/availability.constants.js';
import { civilDate } from '../availability/availability.validation.js';
import { DOCTOR_LANGUAGES } from './doctorApplication.constants.js';

export const DIRECTORY_SORTS = Object.freeze(['rating', 'priceLow', 'priceHigh', 'reviews', 'soonest']);

const optionalBlank = (schema) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

/** GET /api/v1/doctors — every filter optional; unknown query keys rejected. */
export const directoryQuerySchema = z
  .object({
    q: optionalBlank(z.string().trim().max(100)),
    specialtyId: optionalBlank(z.string().uuid()),
    language: optionalBlank(z.enum(DOCTOR_LANGUAGES)),
    minFee: optionalBlank(z.coerce.number().min(0).max(1000)),
    maxFee: optionalBlank(z.coerce.number().min(0).max(1000)),
    sort: z.enum(DIRECTORY_SORTS).default('rating'),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(12),
  })
  .strict()
  .refine((v) => v.minFee === undefined || v.maxFee === undefined || v.minFee <= v.maxFee, { message: 'Minimum fee must not exceed the maximum', path: ['minFee'] });

export const publicDoctorParamsSchema = z.object({ doctorId: z.string().uuid() }).strict();

export const publicSlotsQuerySchema = z
  .object({
    from: civilDate.optional(),
    days: z.coerce.number().int().min(1).max(MAX_SLOT_QUERY_DAYS).default(7),
    tz: z.string().refine(isValidTimeZone, 'Choose a valid time zone').optional(),
  })
  .strict();
