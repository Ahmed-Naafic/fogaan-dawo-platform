import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const reader = { lang: z.enum(['en', 'so']).optional(), tz: z.string().max(64).optional() };

export const idParamsSchema = z.object({ id: z.uuid() }).strict();

export const listQuerySchema = z
  .object({
    unread: bool.optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    ...reader,
  })
  .strict();

export const streamQuerySchema = z.object(reader).strict();

export const readStateSchema = z.object({ read: z.boolean() }).strict();

export const preferencesSchema = z
  .object({ inAppEnabled: z.boolean().optional(), pushEnabled: z.boolean().optional(), remindersEnabled: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Change at least one setting' });

const b64url = (min, max) => z.string().min(min).max(max).regex(/^[A-Za-z0-9_-]+=*$/, 'Must be URL-safe base64');

/** The browser's PushSubscription.toJSON(). */
export const subscriptionSchema = z
  .object({
    endpoint: z.url().max(1024),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({ p256dh: b64url(80, 100), auth: b64url(16, 32) }).strict(),
  })
  .strict();

export const unsubscribeSchema = z.object({ endpoint: z.url().max(1024) }).strict();
