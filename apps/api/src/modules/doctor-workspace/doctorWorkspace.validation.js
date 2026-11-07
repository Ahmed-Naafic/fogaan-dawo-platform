import { z } from 'zod';
import { rangeFields } from '../finance/finance.validation.js';

/** Strict query schemas for the doctor's own workspace (My Patients, My Earnings). */

const optionalBlank = (schema) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());
const page = {
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
};

export const myPatientsQuerySchema = z.object({ q: optionalBlank(z.string().trim().max(100)), ...page }).strict();

export const myPatientParamsSchema = z.object({ patientId: z.uuid() }).strict();

export const EARNING_STATUSES = Object.freeze(['PENDING', 'AVAILABLE', 'PARTIALLY_REFUNDED', 'REFUNDED']);

export const myEarningsQuerySchema = z.object({ ...rangeFields, status: optionalBlank(z.enum(EARNING_STATUSES)), ...page }).strict();
