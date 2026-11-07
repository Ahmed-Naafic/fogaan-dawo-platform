/**
 * Pure form logic for the login/register screen (no React), so it is unit-tested directly.
 * Client-side checks mirror the API's Zod rules for instant, translated feedback; the API remains
 * the authority and its stable error codes are mapped to translation keys below.
 */

const E164 = /^\+[1-9]\d{7,14}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizePhone(value) {
  let v = String(value).trim().replace(/[\s().-]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  return v;
}

/** "Email or Phone" field → { email } | { phone } | { error } */
export function parseIdentifier(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { error: 'authValidation.identifierRequired' };
  if (value.includes('@')) {
    const email = value.toLowerCase();
    return EMAIL.test(email) ? { email } : { error: 'authValidation.invalidEmail' };
  }
  const phone = normalizePhone(value);
  return E164.test(phone) ? { phone } : { error: 'authValidation.invalidPhone' };
}

function checkNewPassword(password) {
  if (!password) return 'authValidation.passwordRequired';
  if (password.length < 8) return 'authValidation.passwordTooShort';
  if (new TextEncoder().encode(password).length > 72) return 'authValidation.passwordTooLong';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'authValidation.passwordWeak';
  return null;
}

/**
 * Validates the form for `mode` ('login' | 'register').
 * Returns { errors: { field: translationKey }, payload } — payload is the API request body.
 */
export function validateAuthForm(mode, values, { language } = {}) {
  const errors = {};
  const id = parseIdentifier(values.identifier);
  if (id.error) errors.identifier = id.error;

  if (mode === 'register') {
    if (!String(values.fullName ?? '').trim() || String(values.fullName).trim().length < 2) errors.fullName = 'authValidation.fullNameRequired';
    const pw = checkNewPassword(values.password ?? '');
    if (pw) errors.password = pw;
    if (!errors.password && values.password !== values.passwordConfirmation) errors.passwordConfirmation = 'authValidation.passwordMismatch';
  } else if (!values.password) {
    errors.password = 'authValidation.passwordRequired';
  }

  if (Object.keys(errors).length) return { errors, payload: null };

  const identity = id.email ? { email: id.email } : { phone: id.phone };
  const payload =
    mode === 'register'
      ? {
          fullName: values.fullName.trim(),
          ...identity,
          password: values.password,
          passwordConfirmation: values.passwordConfirmation,
          ...(language ? { preferredLanguage: language } : {}),
        }
      : { ...identity, password: values.password }; // no role: the API uses the account's assigned roles
  return { errors, payload };
}

/** Stable API error codes this screen understands; anything else shows the generic message. */
const KNOWN_ERROR_CODES = new Set([
  'INVALID_CREDENTIALS',
  'EMAIL_TAKEN',
  'PHONE_TAKEN',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_DISABLED',
  'ACCOUNT_NOT_ACTIVE',
  'ROLE_NOT_ASSIGNED',
  'ROLE_UNAVAILABLE',
  'NO_USABLE_ROLE',
  'RATE_LIMITED',
  'VALIDATION_ERROR',
  'NETWORK_ERROR',
  'SESSION_EXPIRED',
  'SESSION_REVOKED',
  'REFRESH_TOKEN_REUSED',
]);

export const errorMessageKey = (error) => `authErrors.${KNOWN_ERROR_CODES.has(error?.code) ? error.code : 'GENERIC'}`;

/** Maps API error details / codes to form fields to highlight. */
export function fieldsForError(error) {
  if (error?.code === 'EMAIL_TAKEN' || error?.code === 'PHONE_TAKEN') return ['identifier'];
  if (error?.code === 'INVALID_CREDENTIALS') return ['identifier', 'password'];
  if (error?.code !== 'VALIDATION_ERROR' || !Array.isArray(error.details)) return [];
  const map = { email: 'identifier', phone: 'identifier', fullName: 'fullName', password: 'password', passwordConfirmation: 'passwordConfirmation' };
  return [...new Set(error.details.map((d) => map[d.path]).filter(Boolean))];
}
