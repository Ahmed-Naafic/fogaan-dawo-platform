import { z } from 'zod';
import { PRESETS } from './finance.dates.js';

/** Strict query/body schemas for admin finance (unknown fields rejected; no mass assignment). */

const optionalBlank = (schema) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Date-range fields shared by every finance query: preset (today, 7d, 30d, month, custom, all) + zone. */
export const rangeFields = {
  preset: optionalBlank(z.enum(PRESETS)),
  fromDate: optionalBlank(date),
  toDate: optionalBlank(date),
  tz: optionalBlank(z.string().trim().max(64).regex(/^[A-Za-z0-9_+\-/]+$/)),
};
const page = {
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
};

export const rangeQuerySchema = z.object(rangeFields).strict();
export const earningsQuerySchema = z.object({ ...rangeFields, q: optionalBlank(z.string().trim().max(100)), ...page }).strict();
export const exportQuerySchema = z.object({ ...rangeFields, type: z.enum(['summary', 'payments', 'refunds', 'doctor-earnings']), q: optionalBlank(z.string().trim().max(100)) }).strict();

export const rejectRefundSchema = z.object({ reason: z.string().trim().min(10, 'Give a reason of at least 10 characters').max(500) }).strict();

/** The administrator must explicitly confirm a commission change. */
export const commissionSchema = z
  .object({
    percent: z.union([z.string().trim().max(10), z.number()]),
    confirm: z.literal(true, { message: 'Confirm the change' }),
  })
  .strict();
