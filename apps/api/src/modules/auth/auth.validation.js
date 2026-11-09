import { z } from 'zod';
import { MAX_PASSWORD_BYTES } from '../../utils/password.js';

/**
 * Request schemas. Normalisation happens here so services only ever see canonical values:
 * - email: trimmed + lower-cased
 * - phone: E.164 (+ and 8–15 digits). Separators are removed and a leading "00" becomes "+".
 *   Local formats without a country code (e.g. 061…) are rejected rather than guessed, because
 *   users register from Somalia and the diaspora.
 */
export const normalizeEmail = (value) => value.trim().toLowerCase();

/** Normalises a phone number to E.164 (+252…) or returns null when it is not a valid number. */
export function normalizePhone(value) {
  let v = value.trim().replace(/[\s().-]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  return v;
}

const email = z
  .string()
  .trim()
  .max(254)
  .transform(normalizeEmail)
  .pipe(z.email({ message: 'Enter a valid email address' }));

const phone = z
  .string()
  .max(32)
  .transform(normalizePhone)
  .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Enter the phone number in international format, e.g. +252612345678'));

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((v) => Buffer.byteLength(v, 'utf8') <= MAX_PASSWORD_BYTES, `Password must be at most ${MAX_PASSWORD_BYTES} bytes`)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain at least one letter and one number');

const role = z.enum(['PATIENT', 'DOCTOR', 'ADMIN']);

const optional = (schema) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Full name is required').max(160),
    email: optional(email),
    phone: optional(phone),
    password,
    passwordConfirmation: z.string(),
    preferredLanguage: z.enum(['en', 'so']).optional(),
  })
  .strict()
  .refine((d) => d.email || d.phone, { message: 'Provide an email address or a phone number', path: ['email'] })
  .refine((d) => d.password === d.passwordConfirmation, { message: 'Passwords do not match', path: ['passwordConfirmation'] });

export const loginSchema = z
  .object({
    email: optional(email),
    phone: optional(phone),
    password: z.string().min(1, 'Password is required').max(200),
    role: role.optional(),
  })
  .strict()
  .refine((d) => Boolean(d.email) !== Boolean(d.phone), { message: 'Provide either an email address or a phone number', path: ['email'] });

/** Native clients send the refresh token in the body; web clients rely on the HTTP-only cookie. */
export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(400).optional() }).strict();

export const logoutSchema = refreshSchema;

export const switchRoleSchema = z.object({ role }).strict();

/**
 * Google sign-in. `next` is where the web app continues afterwards: an internal path only (the web app
 * re-checks it against the user's roles). `language` only sets Google's screen language and, for a new
 * account, its preferred language — never anything about identity.
 */
const language = z.enum(['en', 'so']).optional();
export const googleStartSchema = z
  .object({
    next: optional(
      z
        .string()
        .max(300)
        .regex(/^\/[A-Za-z0-9\-_/?=&%.]*$/, 'next must be an internal path')
        .refine((v) => !v.includes('//'), 'next must be an internal path'),
    ),
    language,
  })
  .strict();

export const googleLinkSchema = z.object({ language }).strict();

/** Shared with the profile module (same normalisation as registration). */
export { phone as phoneSchema, password as passwordSchema };

/**
 * Change password (signed-in user who already has a password). The new password follows the
 * registration rules and must differ from the current one.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(200),
    newPassword: password,
    newPasswordConfirmation: z.string().max(200),
  })
  .strict()
  .refine((d) => d.newPassword === d.newPasswordConfirmation, { message: 'Passwords do not match', path: ['newPasswordConfirmation'] })
  .refine((d) => d.newPassword !== d.currentPassword, { message: 'Choose a password different from your current one', path: ['newPassword'] });
