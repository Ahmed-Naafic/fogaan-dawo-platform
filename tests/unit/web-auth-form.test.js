// Unit tests for the login/register form logic and role routing (apps/web/src/features/auth).
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorMessageKey, fieldsForError, parseIdentifier, validateAuthForm } from '../../apps/web/src/features/auth/authForm.js';
import { rolesForPath, safeNext } from '../../apps/web/src/features/auth/roles.js';

const dict = (lang) => JSON.parse(readFileSync(new URL(`../../apps/web/src/locales/${lang}.json`, import.meta.url), 'utf8'));
const EN = dict('en');
const SO = dict('so');
const tr = (d, key) => key.split('.').reduce((n, k) => n?.[k], d);

test('identifier: email is lower-cased, phone is normalised to E.164, local numbers rejected', () => {
  assert.deepEqual(parseIdentifier('  Amina@Example.COM '), { email: 'amina@example.com' });
  assert.deepEqual(parseIdentifier('00252 61-555 0101'), { phone: '+252615550101' });
  assert.deepEqual(parseIdentifier('+44 7700 900123'), { phone: '+447700900123' });
  assert.equal(parseIdentifier('0612345678').error, 'authValidation.invalidPhone');
  assert.equal(parseIdentifier('amina@').error, 'authValidation.invalidEmail');
  assert.equal(parseIdentifier('').error, 'authValidation.identifierRequired');
});

test('register validation mirrors the API rules and builds the request body', () => {
  const ok = validateAuthForm('register', { fullName: ' Amina Cabdi ', identifier: '+252615550101', password: 'Correct-42', passwordConfirmation: 'Correct-42' }, { language: 'so' });
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.payload, { fullName: 'Amina Cabdi', phone: '+252615550101', password: 'Correct-42', passwordConfirmation: 'Correct-42', preferredLanguage: 'so' });
  assert.equal('role' in ok.payload, false, 'registration never sends a role');

  const bad = validateAuthForm('register', { fullName: '', identifier: 'x', password: 'short', passwordConfirmation: 'other' });
  assert.equal(bad.payload, null);
  assert.deepEqual(bad.errors, { identifier: 'authValidation.invalidPhone', fullName: 'authValidation.fullNameRequired', password: 'authValidation.passwordTooShort' });
  assert.equal(validateAuthForm('register', { fullName: 'Amina', identifier: 'a@b.co', password: 'Correct-42', passwordConfirmation: 'Correct-43' }).errors.passwordConfirmation, 'authValidation.passwordMismatch');
  assert.equal(validateAuthForm('register', { fullName: 'Amina', identifier: 'a@b.co', password: 'onlyletters', passwordConfirmation: 'onlyletters' }).errors.password, 'authValidation.passwordWeak');
  assert.equal(validateAuthForm('register', { fullName: 'Amina', identifier: 'a@b.co', password: `a1${'x'.repeat(80)}`, passwordConfirmation: '' }).errors.password, 'authValidation.passwordTooLong');
});

test('login validation: email or phone, never a role', () => {
  assert.deepEqual(validateAuthForm('login', { identifier: 'A@B.CO', password: 'x' }).payload, { email: 'a@b.co', password: 'x' });
  assert.deepEqual(validateAuthForm('login', { identifier: '+252615550101', password: 'x' }, { role: 'DOCTOR' }).payload, { phone: '+252615550101', password: 'x' });
  assert.equal(validateAuthForm('login', { identifier: 'a@b.co', password: '' }).errors.password, 'authValidation.passwordRequired');
});

test('every validation and error message exists in English and Somali (and differs)', () => {
  const keys = [
    ...Object.keys(EN.authValidation).map((k) => `authValidation.${k}`),
    ...Object.keys(EN.authErrors).map((k) => `authErrors.${k}`),
    'authz.forbiddenTitle',
    'authz.forbiddenBody',
    'auth.confirmPassword',
    'common.signOutAll',
  ];
  for (const key of keys) {
    assert.equal(typeof tr(EN, key), 'string', `en missing ${key}`);
    assert.equal(typeof tr(SO, key), 'string', `so missing ${key}`);
    assert.notEqual(tr(EN, key), tr(SO, key), `${key} not translated`);
  }
  assert.equal(tr(EN, 'authValidation.passwordMismatch'), 'Passwords do not match.');
  assert.equal(tr(SO, 'authValidation.passwordMismatch'), 'Furayaasha sirtu isma laha.');
});

test('API error codes map to translation keys and form fields', () => {
  for (const code of ['INVALID_CREDENTIALS', 'EMAIL_TAKEN', 'PHONE_TAKEN', 'ACCOUNT_SUSPENDED', 'RATE_LIMITED', 'NETWORK_ERROR']) {
    const key = errorMessageKey({ code });
    assert.equal(key, `authErrors.${code}`);
    assert.ok(tr(EN, key) && tr(SO, key));
  }
  assert.equal(errorMessageKey({ code: 'SOMETHING_NEW' }), 'authErrors.GENERIC');
  assert.deepEqual(fieldsForError({ code: 'EMAIL_TAKEN' }), ['identifier']);
  assert.deepEqual(fieldsForError({ code: 'VALIDATION_ERROR', details: [{ path: 'phone' }, { path: 'passwordConfirmation' }] }), ['identifier', 'passwordConfirmation']);
});

test('post-login redirect only honours internal paths the user may open', () => {
  const patient = { activeRole: 'PATIENT', roles: ['PATIENT'] };
  const multi = { activeRole: 'PATIENT', roles: ['PATIENT', 'DOCTOR'] };
  assert.equal(safeNext('/patient/doctors?specialty=cardiology', patient), '/patient/doctors?specialty=cardiology');
  assert.equal(safeNext('/doctor', patient), '/patient', 'no DOCTOR role → home');
  assert.equal(safeNext('/doctor', multi), '/doctor');
  for (const evil of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '/patient//evil', null]) {
    assert.equal(safeNext(evil, patient), '/patient', `rejects ${evil}`);
  }
  assert.deepEqual(rolesForPath('/consultation/abc'), ['PATIENT', 'DOCTOR']);
  assert.equal(rolesForPath('/'), null);
});
