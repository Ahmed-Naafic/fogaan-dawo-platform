import { z } from 'zod';
import { PROVIDER_CODES } from '../../adapters/payment/index.js';
import { rangeFields } from '../finance/finance.validation.js';

/** Strict: the client chooses a method and wallet only — never an amount, a status or an outcome. */

export const payBodySchema = z
  .object({
    provider: z.enum(PROVIDER_CODES),
    wallet: z.string().trim().transform((v) => v.replace(/[\s-]/g, '')).pipe(z.string().max(20)),
  })
  .strict();

/** Idempotency-Key header: one per payment attempt (the web client generates a random UUID). */
export const idempotencyHeaderSchema = z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9._:-]+$/);

export const paymentParamsSchema = z.object({ paymentId: z.string().uuid() }).strict();
export const refundParamsSchema = z.object({ refundId: z.string().uuid() }).strict();

const optionalBlank = (schema) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

export const adminPaymentQuerySchema = z
  .object({
    status: optionalBlank(z.enum(['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED'])),
    provider: optionalBlank(z.enum(PROVIDER_CODES)),
    q: optionalBlank(z.string().trim().max(100)),
    ...rangeFields,
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const adminRefundQuerySchema = z
  .object({
    status: optionalBlank(z.enum(['REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REJECTED'])),
    q: optionalBlank(z.string().trim().max(100)),
    ...rangeFields,
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const emptyBodySchema = z.object({}).strict();
