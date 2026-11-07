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

/** A reason is required: it is shown in the audit log and on cancelled appointments. */
export const suspendDoctorSchema = z
  .object({ reason: z.string().trim().min(10, 'Give a reason of at least 10 characters').max(500) })
  .strict();
