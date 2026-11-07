import { z } from 'zod';
import { MAX_ITEMS } from './prescription.policy.js';

/**
 * Prescription request schemas (strict: no status, ids, tokens, PDF or audit fields can be sent).
 * Free text is bounded; no medicine is ever suggested by the system.
 */
const text = (min, max, message) => z.string().trim().min(min, message).max(max);
const optionalText = (max) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable().optional());

export const itemSchema = z
  .object({
    medicineName: text(2, 180, 'Enter the medicine name'),
    dose: text(1, 120, 'Enter the dosage'),
    frequency: text(1, 120, 'Enter how often to take it'),
    duration: text(1, 120, 'Enter for how long'),
    quantity: optionalText(60),
    instructions: optionalText(1000),
    warnings: optionalText(1000),
  })
  .strict();

const items = z.array(itemSchema).min(1, 'Add at least one medicine').max(MAX_ITEMS, `At most ${MAX_ITEMS} medicines per prescription`);

export const draftSchema = z.object({ items, generalNotes: optionalText(2000) }).strict();

export const draftUpdateSchema = z
  .object({ items: items.optional(), generalNotes: optionalText(2000) })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

const reason = z.string().trim().min(10, 'Give a reason of at least 10 characters').max(500);

export const cancelSchema = z.object({ reason }).strict();

/** A correction: the full new content plus why the original is being replaced. */
export const replaceSchema = z.object({ reason, items, generalNotes: optionalText(2000) }).strict();

export const prescriptionParamsSchema = z.object({ prescriptionId: z.uuid() }).strict();

export const listQuerySchema = z
  .object({
    status: z.enum(['DRAFT', 'VALID', 'CANCELLED', 'REPLACED']).optional(),
    page: z.coerce.number().int().min(1).max(1000).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

/** Public QR token: base64url, 43 chars for 256 bits; accept a sane range, never echo it back. */
export const verifyParamsSchema = z.object({ token: z.string().min(16).max(200).regex(/^[A-Za-z0-9_-]+$/) }).strict();
