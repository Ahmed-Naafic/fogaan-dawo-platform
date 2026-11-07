// Unit tests: server-side file validation and the web doctor-application form logic.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDocumentType, MAX_DOCUMENT_BYTES, safeDisplayName } from '../../apps/api/src/utils/fileType.js';
import { checkFile, doctorErrorKey, fieldsForApiError, formFromApplication, isDirty, validateApplication } from '../../apps/web/src/features/doctors/doctorApplicationForm.js';

const dict = (lang) => JSON.parse(readFileSync(new URL(`../../apps/web/src/locales/${lang}.json`, import.meta.url), 'utf8'));
const EN = dict('en');
const SO = dict('so');
const tr = (d, key) => key.split('.').reduce((n, k) => n?.[k], d);

test('document type is detected from the bytes, not the name or browser MIME type', () => {
  assert.deepEqual(detectDocumentType(Buffer.from('%PDF-1.7\n%âãÏÓ\n')), { mime: 'application/pdf', ext: 'pdf' });
  assert.deepEqual(detectDocumentType(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), randomBytes(8)])), { mime: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(detectDocumentType(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(8)])), { mime: 'image/png', ext: 'png' });
  for (const bad of [Buffer.from('<html><script>alert(1)</script>'), Buffer.from('MZ\x90\x00\x03\x00\x00\x00'), Buffer.from('GIF89a......'), Buffer.from('%PDF'), Buffer.alloc(0)]) {
    assert.equal(detectDocumentType(bad), null);
  }
  assert.equal(MAX_DOCUMENT_BYTES, 5 * 1024 * 1024);
});

test('display names are sanitised and forced to the detected extension', () => {
  assert.equal(safeDisplayName('licence.pdf', 'pdf'), 'licence.pdf');
  assert.equal(safeDisplayName('..%2F..%2Fetc%2Fpasswd.exe', 'pdf'), 'passwd.pdf');
  assert.equal(safeDisplayName('C:\\Users\\me\\scan<1>.png', 'jpg'), 'scan1.jpg');
  assert.equal(safeDisplayName('', 'png'), 'document.png');
  assert.equal(safeDisplayName('....', 'pdf'), 'document.pdf');
  assert.equal(safeDisplayName(`${'x'.repeat(300)}.pdf`, 'pdf').length, 104);
  assert.equal(safeDisplayName('%E0%A4%A', 'pdf'), '%E0%A4%A.pdf', 'malformed encoding does not throw');
});

const valid = {
  professionalName: 'Dr. Hodan Axmed',
  specialtyId: '11111111-2222-4333-8444-555555555555',
  licenceNumber: 'SMC-2019/0457',
  licenceCountry: 'Somalia',
  consultationFee: '25.50',
  bio: 'Board-certified cardiologist with nine years of clinical experience in Mogadishu.',
  yearsExperience: '9',
  languages: ['so', 'en', 'so'],
};

test('application form mirrors the API rules and builds the request body', () => {
  const ok = validateApplication(valid);
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.payload, { ...valid, consultationFee: 25.5, yearsExperience: 9, languages: ['so', 'en'] });
  assert.equal('yearsExperience' in validateApplication({ ...valid, yearsExperience: '' }).payload, false, 'optional field omitted');

  const cases = {
    professionalName: [{ professionalName: 'Dr' }],
    specialtyId: [{ specialtyId: '' }, { specialtyId: 'cardiology' }],
    licenceNumber: [{ licenceNumber: '' }, { licenceNumber: '<script>' }],
    licenceCountry: [{ licenceCountry: 'S' }, { licenceCountry: '1234' }],
    consultationFee: [{ consultationFee: '' }, { consultationFee: '4.99' }, { consultationFee: '200.01' }, { consultationFee: '10.555' }, { consultationFee: 'ten' }],
    bio: [{ bio: 'short' }, { bio: 'x'.repeat(2001) }],
    yearsExperience: [{ yearsExperience: '61' }, { yearsExperience: '2.5' }],
    languages: [{ languages: [] }, { languages: ['xx'] }],
  };
  for (const [field, overrides] of Object.entries(cases)) {
    for (const over of overrides) {
      const { errors, payload } = validateApplication({ ...valid, ...over });
      assert.equal(payload, null);
      assert.equal(errors[field], `doctorValidation.${field === 'specialtyId' ? 'specialty' : field}`, `${field} ${JSON.stringify(over)}`);
    }
  }
  assert.equal(validateApplication({ ...valid, consultationFee: '5' }).payload.consultationFee, 5);
  assert.equal(validateApplication({ ...valid, consultationFee: '200' }).payload.consultationFee, 200);
});

test('unsaved changes are detected against the saved application', () => {
  const app = { professionalName: 'Dr. Hodan', specialty: { id: valid.specialtyId }, licenceNumber: 'A1', licenceCountry: 'Somalia', consultationFee: '25.00', bio: 'b', yearsExperience: null, languages: ['so', 'en'] };
  const form = formFromApplication(app);
  assert.equal(isDirty(form, app), false);
  assert.equal(isDirty({ ...form, languages: ['en', 'so'] }, app), false, 'language order does not matter');
  assert.equal(isDirty({ ...form, consultationFee: '30.00' }, app), true);
});

test('client file pre-check: size and extension (server re-checks the bytes)', () => {
  assert.equal(checkFile({ name: 'licence.pdf', size: 1000 }), null);
  assert.equal(checkFile({ name: 'scan.JPEG', size: 1000 }), null);
  assert.equal(checkFile({ name: 'licence.pdf', size: 0 }), 'doctorValidation.fileEmpty');
  assert.equal(checkFile({ name: 'licence.pdf', size: 5 * 1024 * 1024 + 1 }), 'doctorValidation.fileTooLarge');
  assert.equal(checkFile({ name: 'licence.docx', size: 1000 }), 'doctorValidation.fileType');
  assert.equal(checkFile(null), 'doctorValidation.fileType');
});

test('API error codes map to translated messages and fields', () => {
  for (const code of ['APPLICATION_LOCKED', 'APPLICATION_INCOMPLETE', 'FILE_TYPE_NOT_ALLOWED', 'SELF_REVIEW_FORBIDDEN', 'INVALID_STATUS_TRANSITION', 'PAYLOAD_TOO_LARGE']) {
    assert.equal(doctorErrorKey({ code }), `doctorErrors.${code}`);
  }
  assert.equal(doctorErrorKey({ code: 'SOMETHING_ELSE' }), 'doctorErrors.GENERIC');
  assert.deepEqual(fieldsForApiError({ code: 'SPECIALTY_NOT_FOUND' }), ['specialtyId']);
  assert.deepEqual(fieldsForApiError({ code: 'VALIDATION_ERROR', details: [{ path: 'languages.0' }, { path: 'bio' }] }), ['languages', 'bio']);
});

test('every doctor-management message exists in English and Somali', () => {
  const sections = ['doctorApp', 'doctorValidation', 'doctorErrors', 'verification', 'doctorDash', 'appStatus', 'docType', 'languageNames'];
  const keys = (obj, prefix) => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}.${k}`) : [`${prefix}.${k}`]));
  for (const section of sections) {
    for (const key of keys(EN[section], section)) {
      assert.equal(typeof tr(SO, key), 'string', `so missing ${key}`);
    }
  }
  assert.ok(tr(EN, 'auth.doctorSignupNote') && tr(SO, 'auth.doctorSignupNote'));
});
