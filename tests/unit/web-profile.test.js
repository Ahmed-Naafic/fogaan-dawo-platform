// Unit tests: profile page helpers (form → minimal PATCH payloads, client checks, error mapping) and
// translation coverage for every new profile key in English and Somali.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkPhotoFile,
  doctorForm,
  entryChanges,
  patientForm,
  profileErrorKey,
  validateDoctorForm,
  validateEntry,
  validatePatientForm,
} from '../../apps/web/src/features/profile/profileUi.js';

const profile = {
  fullName: 'Amina Warsame',
  preferredLanguage: 'en',
  dateOfBirth: '1992-03-15',
  sex: 'FEMALE',
  address: { city: 'Hargeisa', addressLine: null },
  emergencyContact: { name: 'Hodan', relationship: 'Sister', phone: '+252634445566' },
};

test('patient form sends only changed fields — never email, phone or role', () => {
  const form = patientForm(profile);
  assert.deepEqual(validatePatientForm(form, profile).payload, {}, 'unchanged form → empty payload');
  const changed = { ...form, preferredLanguage: 'so', city: 'Mogadishu', emergencyPhone: '00252 61 111 2222' };
  const { payload } = validatePatientForm(changed, profile);
  assert.deepEqual(payload, {
    preferredLanguage: 'so',
    address: { city: 'Mogadishu', addressLine: null },
    emergencyContact: { name: 'Hodan', relationship: 'Sister', phone: '+252611112222' },
  });
  for (const k of ['email', 'phone', 'role', 'roles', 'status']) assert.equal(k in payload, false);
  const cleared = validatePatientForm({ ...form, city: '', emergencyName: '', emergencyRelationship: '', emergencyPhone: '', dateOfBirth: '' }, profile).payload;
  assert.deepEqual(cleared, { dateOfBirth: null, address: null, emergencyContact: null });
});

test('patient form validation mirrors the API rules', () => {
  const form = patientForm(profile);
  assert.ok(validatePatientForm({ ...form, fullName: 'A' }, profile).errors.fullName);
  assert.ok(validatePatientForm({ ...form, dateOfBirth: '2999-01-01' }, profile).errors.dateOfBirth);
  assert.ok(validatePatientForm({ ...form, emergencyPhone: '0612345678' }, profile).errors.emergencyPhone);
  assert.ok(validatePatientForm({ ...form, emergencyRelationship: '' }, profile).errors.emergencyRelationship);
  assert.ok(validatePatientForm({ ...form, city: '', addressLine: 'Street 1' }, profile).errors.city);
});

test('medical entry form: validation and minimal changes', () => {
  assert.ok(validateEntry({ entryType: 'ALLERGY', title: 'x', description: '', recordedAt: '' }).errors.title);
  assert.ok(validateEntry({ entryType: 'DIAGNOSIS', title: 'Penicillin', description: '', recordedAt: '' }).errors.entryType);
  const ok = validateEntry({ entryType: 'ALLERGY', title: ' Penicillin ', description: '', recordedAt: '2020-01-01' });
  assert.deepEqual(ok.payload, { entryType: 'ALLERGY', title: 'Penicillin', description: null, recordedAt: '2020-01-01' });
  const entry = { entryType: 'ALLERGY', title: 'Penicillin', description: null, recordedAt: '2020-01-01T00:00:00.000Z' };
  assert.deepEqual(entryChanges(ok.payload, entry), {});
  assert.deepEqual(entryChanges({ ...ok.payload, description: 'Hives' }, entry), { description: 'Hives' });
});

test('doctor form: only professional fields, minimal payload, fee/years/bio bounds', () => {
  const doc = { bio: 'x'.repeat(60), qualifications: null, yearsExperience: 5, consultationFee: '20.00', languages: ['so', 'en'] };
  const form = doctorForm(doc);
  assert.deepEqual(validateDoctorForm(form, doc).payload, {});
  assert.deepEqual(validateDoctorForm({ ...form, consultationFee: '25', languages: ['en', 'so'] }, doc).payload, { consultationFee: 25 }, 'language order is not a change');
  assert.ok(validateDoctorForm({ ...form, consultationFee: '4' }, doc).errors.consultationFee);
  assert.ok(validateDoctorForm({ ...form, consultationFee: '20.123' }, doc).errors.consultationFee);
  assert.ok(validateDoctorForm({ ...form, bio: 'short' }, doc).errors.bio);
  assert.ok(validateDoctorForm({ ...form, yearsExperience: '61' }, doc).errors.yearsExperience);
  assert.ok(validateDoctorForm({ ...form, languages: [] }, doc).errors.languages);
  const payload = validateDoctorForm({ ...form, qualifications: 'MBBS' }, doc).payload;
  assert.deepEqual(Object.keys(payload), ['qualifications']);
});

test('photo pre-check and error keys', () => {
  assert.equal(checkPhotoFile({ size: 0, type: 'image/png' }), 'profileErrors.FILE_EMPTY');
  assert.equal(checkPhotoFile({ size: 3 * 1024 * 1024, type: 'image/png' }), 'profileErrors.PAYLOAD_TOO_LARGE');
  assert.equal(checkPhotoFile({ size: 100, type: 'image/svg+xml' }), 'profileErrors.PHOTO_TYPE_NOT_ALLOWED');
  assert.equal(checkPhotoFile({ size: 100, type: 'image/jpeg' }), null);
  assert.equal(profileErrorKey({ code: 'HISTORY_DOCTOR_ENTRY_READ_ONLY' }), 'profileErrors.HISTORY_DOCTOR_ENTRY_READ_ONLY');
  assert.equal(profileErrorKey({ code: 'SOMETHING_ELSE', status: 500 }), 'profileErrors.GENERIC');
  assert.equal(profileErrorKey({ code: 'X', status: 403 }), 'profileErrors.FORBIDDEN');
});

test('every profile translation exists in English and Somali', () => {
  const en = JSON.parse(readFileSync(new URL('../../apps/web/src/locales/en.json', import.meta.url)));
  const so = JSON.parse(readFileSync(new URL('../../apps/web/src/locales/so.json', import.meta.url)));
  const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  for (const ns of ['profile', 'medical', 'myDoctorProfile', 'security', 'profileErrors', 'patientInfo']) {
    const a = flat(en[ns]).sort();
    const b = flat(so[ns]).sort();
    assert.ok(a.length > 5, ns);
    assert.deepEqual(a, b, `${ns}: same keys in both languages`);
    for (const k of b) assert.ok(String(k.split('.').reduce((x, p) => x[p], so[ns])).trim(), `so.${ns}.${k} is not empty`);
  }
});
