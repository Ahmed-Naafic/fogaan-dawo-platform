// Unit tests (Phase 9): profile validation, completeness, medical-history ownership rules, doctor
// verification restrictions, public field filtering, photo upload safety and availability permissions.
// No database, no network (sharp runs in-process).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { roleHasPermission, Permission } from '../../apps/api/src/modules/auth/auth.permissions.js';
import { changePasswordSchema } from '../../apps/api/src/modules/auth/auth.validation.js';
import { entryPermissions, presentEntry } from '../../apps/api/src/modules/medical-history/medicalHistory.service.js';
import { doctorCompleteness, patientCompleteness } from '../../apps/api/src/modules/profiles/profile.completeness.js';
import {
  doctorProfileSchema,
  historyEntryCreateSchema,
  historyEntryUpdateSchema,
  licenceReplaceQuerySchema,
  patientProfileSchema,
} from '../../apps/api/src/modules/profiles/profile.validation.js';
import { NAME_LOCKED_DOCTOR_STATUSES } from '../../apps/api/src/modules/profiles/patientProfile.service.js';
import { checkPhotoUpload, MAX_PHOTO_BYTES, processProfilePhoto } from '../../apps/api/src/utils/imageProcessing.js';

const ok = (schema, v) => schema.safeParse(v);
const issues = (r) => (r.success ? [] : r.error.issues.map((i) => i.path.join('.') || '(root)'));

/* ------------------------------------------------------------ patient profile validation */

test('patient profile: valid partial updates are accepted and normalised', () => {
  const r = ok(patientProfileSchema, {
    fullName: '  Amina Yusuf ',
    preferredLanguage: 'so',
    dateOfBirth: '1990-04-12',
    sex: 'FEMALE',
    address: { city: 'Mogadishu', addressLine: '' },
    emergencyContact: { name: 'Hodan Yusuf', relationship: 'Sister', phone: '00252 61 234 5678' },
  });
  assert.equal(r.success, true, JSON.stringify(issues(r)));
  assert.equal(r.data.fullName, 'Amina Yusuf');
  assert.equal(r.data.address.addressLine, null, 'blank optional text becomes null');
  assert.equal(r.data.emergencyContact.phone, '+252612345678', 'phone normalised to E.164');
  assert.equal(ok(patientProfileSchema, { dateOfBirth: null, sex: null, address: null, emergencyContact: null }).success, true, 'clearing optional data is allowed');
  assert.equal(ok(patientProfileSchema, { dateOfBirth: '' }).data.dateOfBirth, null);
});

test('patient profile: no mass assignment — email, phone, role, status and unknown keys are rejected', () => {
  for (const key of ['email', 'phone', 'role', 'roles', 'status', 'emailVerifiedAt', 'passwordHash', 'id', 'userId', 'verificationStatus']) {
    const r = ok(patientProfileSchema, { fullName: 'Amina Yusuf', [key]: 'x' });
    assert.equal(r.success, false, `${key} must be rejected`);
  }
  assert.equal(ok(patientProfileSchema, { emergencyContact: { name: 'A B', relationship: 'Sister', phone: '+252612345678', extra: 1 } }).success, false);
  assert.equal(ok(patientProfileSchema, {}).success, false, 'empty update rejected');
});

test('patient profile: formats and lengths are enforced', () => {
  const bad = [
    { fullName: 'A' },
    { fullName: 'x'.repeat(161) },
    { preferredLanguage: 'fr' },
    { dateOfBirth: '1990-02-30' },
    { dateOfBirth: '12/04/1990' },
    { dateOfBirth: '1850-01-01' },
    { dateOfBirth: '2999-01-01' },
    { sex: 'OTHER_VALUE' },
    { address: { city: 'M' } },
    { address: { city: 'Mogadishu', addressLine: 'x'.repeat(256) } },
    { emergencyContact: { name: 'Hodan', relationship: 'Sister', phone: '0612345678' } },
    { emergencyContact: { name: 'Hodan', phone: '+252612345678' } },
  ];
  for (const v of bad) assert.equal(ok(patientProfileSchema, v).success, false, JSON.stringify(v));
});

/* ------------------------------------------------------------ doctor profile validation */

test('doctor profile: only professional fields; verification, licence, specialty and name cannot be sent', () => {
  const bio = 'Experienced family physician with a focus on preventive care and chronic disease.';
  const r = ok(doctorProfileSchema, { bio, qualifications: 'MBBS (Mogadishu), MSc Public Health', yearsExperience: '8', consultationFee: '25.5', languages: ['so', 'en'] });
  assert.equal(r.success, true, JSON.stringify(issues(r)));
  assert.equal(r.data.yearsExperience, 8);
  assert.equal(r.data.consultationFee, 25.5);
  for (const key of ['verificationStatus', 'verifiedAt', 'accountStatus', 'licenceNumber', 'licenceCountry', 'specialtyId', 'professionalName', 'fullName', 'userId']) {
    assert.equal(ok(doctorProfileSchema, { bio, [key]: 'x' }).success, false, `${key} must be rejected`);
  }
  for (const v of [{ bio: 'too short' }, { consultationFee: 4.99 }, { consultationFee: 200.01 }, { consultationFee: 10.123 }, { yearsExperience: 61 }, { languages: [] }, { languages: ['so', 'so'] }, { languages: ['xx'] }, { qualifications: 'x'.repeat(1001) }]) {
    assert.equal(ok(doctorProfileSchema, v).success, false, JSON.stringify(v));
  }
  assert.equal(ok(doctorProfileSchema, { qualifications: '' }).data.qualifications, null);
});

test('licence replacement requires explicit confirmation and valid licence details', () => {
  assert.equal(ok(licenceReplaceQuerySchema, { licenceNumber: 'SMC-2024/118', licenceCountry: 'Somalia', confirm: 'true' }).success, true);
  assert.equal(ok(licenceReplaceQuerySchema, { licenceNumber: 'SMC-2024/118', licenceCountry: 'Somalia' }).success, false, 'no confirmation');
  assert.equal(ok(licenceReplaceQuerySchema, { licenceNumber: '<script>', licenceCountry: 'Somalia', confirm: 'true' }).success, false);
  assert.equal(ok(licenceReplaceQuerySchema, { licenceNumber: 'SMC-1', licenceCountry: 'Somalia', confirm: 'true', verificationStatus: 'VERIFIED' }).success, false);
});

test('change password: confirmation must match and the new password must differ and be strong', () => {
  assert.equal(ok(changePasswordSchema, { currentPassword: 'Old-pass-1', newPassword: 'New-pass-22', newPasswordConfirmation: 'New-pass-22' }).success, true);
  assert.deepEqual(issues(ok(changePasswordSchema, { currentPassword: 'Old-pass-1', newPassword: 'New-pass-22', newPasswordConfirmation: 'New-pass-23' })), ['newPasswordConfirmation']);
  assert.deepEqual(issues(ok(changePasswordSchema, { currentPassword: 'Same-pass-1', newPassword: 'Same-pass-1', newPasswordConfirmation: 'Same-pass-1' })), ['newPassword']);
  assert.equal(ok(changePasswordSchema, { currentPassword: 'x', newPassword: 'short1', newPasswordConfirmation: 'short1' }).success, false);
  assert.equal(ok(changePasswordSchema, { currentPassword: 'x', newPassword: 'lettersonly', newPasswordConfirmation: 'lettersonly' }).success, false);
});

/* ------------------------------------------------------------ medical history */

test('medical history validation: types, lengths, dates; authorship fields cannot be sent', () => {
  const r = ok(historyEntryCreateSchema, { entryType: 'ALLERGY', title: 'Penicillin', description: 'Rash', recordedAt: '2020-05-01' });
  assert.equal(r.success, true);
  assert.ok(r.data.recordedAt instanceof Date);
  for (const key of ['source', 'createdByUserId', 'consultationId', 'archivedAt', 'medicalHistoryId', 'patientId']) {
    assert.equal(ok(historyEntryCreateSchema, { entryType: 'ALLERGY', title: 'Penicillin', [key]: 'x' }).success, false, key);
    assert.equal(ok(historyEntryUpdateSchema, { [key]: 'x' }).success, false, key);
  }
  for (const v of [{ entryType: 'DIAGNOSIS', title: 'x y' }, { entryType: 'ALLERGY', title: 'x' }, { entryType: 'ALLERGY', title: 'ok', description: 'x'.repeat(4001) }, { entryType: 'ALLERGY', title: 'ok', recordedAt: '2999-01-01' }]) {
    assert.equal(ok(historyEntryCreateSchema, v).success, false, JSON.stringify(v));
  }
  assert.equal(ok(historyEntryUpdateSchema, {}).success, false);
});

test('medical history ownership: patient edits own entries, archives any; doctors only their own', () => {
  const patient = { kind: 'PATIENT', userId: 'p' };
  const doctor = { kind: 'DOCTOR', userId: 'd' };
  const otherDoctor = { kind: 'DOCTOR', userId: 'd2' };
  const patientEntry = { source: 'PATIENT', createdByUserId: 'p', archivedAt: null };
  const doctorEntry = { source: 'DOCTOR', createdByUserId: 'd', archivedAt: null };

  assert.deepEqual(entryPermissions(patientEntry, patient), { canEdit: true, canArchive: true });
  assert.deepEqual(entryPermissions(doctorEntry, patient), { canEdit: false, canArchive: true }, 'patient cannot edit a doctor-written entry but may archive it');
  assert.deepEqual(entryPermissions(doctorEntry, doctor), { canEdit: true, canArchive: true });
  assert.deepEqual(entryPermissions(patientEntry, doctor), { canEdit: false, canArchive: false }, 'doctor never edits patient-written entries');
  assert.deepEqual(entryPermissions(doctorEntry, otherDoctor), { canEdit: false, canArchive: false });
  assert.deepEqual(entryPermissions({ ...patientEntry, archivedAt: new Date() }, patient), { canEdit: false, canArchive: false }, 'archived entries are frozen');
  assert.deepEqual(entryPermissions(patientEntry, null), { canEdit: false, canArchive: false });
});

test('medical history presenter: doctor entries are labelled, ids of authors are not exposed', () => {
  const now = new Date('2026-11-06T10:00:00Z');
  const base = { id: 'e1', entryType: 'CONDITION', title: 'Hypertension', description: null, recordedAt: null, consultationId: 'c1', archivedAt: null, createdAt: now, updatedAt: now };
  const out = presentEntry({ ...base, source: 'DOCTOR', createdByUserId: 'd', updatedByUserId: 'd', author: { fullName: 'Dr Ali' } }, { kind: 'PATIENT', userId: 'p' });
  assert.equal(out.authorName, 'Dr Ali');
  assert.equal(out.fromConsultation, true);
  assert.equal(out.canEdit, false);
  for (const k of ['createdByUserId', 'updatedByUserId', 'consultationId', 'author', 'medicalHistoryId']) assert.equal(k in out, false, k);
  const own = presentEntry({ ...base, consultationId: null, source: 'PATIENT', createdByUserId: 'p', author: { fullName: 'Amina' } }, { kind: 'PATIENT', userId: 'p' });
  assert.equal(own.authorName, null);
  assert.equal(own.canEdit, true);
});

/* ------------------------------------------------------------ completeness & verification restrictions */

test('completeness is informational: optional data only raises the score; required set is minimal', () => {
  const empty = patientCompleteness({ fullName: 'Amina', email: 'a@x.test', phone: null });
  assert.equal(empty.requiredDone, true, 'name + one contact method is all a patient must have');
  assert.ok(empty.percent < 50);
  const full = patientCompleteness({
    fullName: 'Amina', email: 'a@x.test', photo: { hasPhoto: true }, dateOfBirth: '1990-01-01', sex: 'FEMALE',
    address: { city: 'Hargeisa' }, emergencyContact: { name: 'H', phone: '+252612345678' }, medicalHistoryCount: 2,
  });
  assert.equal(full.percent, 100);
  assert.deepEqual(Object.keys(full).sort(), ['items', 'percent', 'requiredDone'], 'no permission-like fields');
});

test('doctor completeness never reaches "required done" without administrator verification', () => {
  const d = { professionalName: 'Dr Ali', specialty: { id: 's' }, consultationFee: '20.00', bio: 'x'.repeat(60), languages: ['so'], qualifications: 'MBBS', yearsExperience: 5, photo: { hasPhoto: true } };
  assert.equal(doctorCompleteness({ ...d, status: 'PENDING' }).requiredDone, false);
  assert.equal(doctorCompleteness({ ...d, status: 'VERIFIED' }).requiredDone, true);
  assert.equal(doctorCompleteness({ ...d, status: 'VERIFIED' }).percent, 100);
  assert.deepEqual(NAME_LOCKED_DOCTOR_STATUSES, ['PENDING', 'UNDER_REVIEW', 'VERIFIED'], 'a submitted/verified doctor cannot rename themselves from the patient profile');
});

test('permissions: profile, history and availability are role-scoped', () => {
  assert.equal(roleHasPermission('PATIENT', Permission.ownMedicalHistoryManage), true);
  assert.equal(roleHasPermission('DOCTOR', Permission.ownMedicalHistoryManage), false, 'doctor role has no access to the patient-owned history API');
  assert.equal(roleHasPermission('ADMIN', Permission.ownMedicalHistoryManage), false);
  assert.equal(roleHasPermission('DOCTOR', Permission.ownDoctorProfileManage), true);
  assert.equal(roleHasPermission('PATIENT', Permission.ownDoctorProfileManage), false, 'pending/rejected applicants act as PATIENT and cannot edit a doctor profile');
  assert.equal(roleHasPermission('PATIENT', Permission.ownAvailabilityManage), false, 'unapproved doctors cannot publish availability');
  assert.equal(roleHasPermission('ADMIN', Permission.ownAvailabilityManage), false);
});

/* ------------------------------------------------------------ photo upload safety */

const jpegWithExif = (w = 800, h = 600) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#2a9d8f' } })
    .jpeg()
    .withExifMerge({ IFD0: { Make: 'TestCam', Model: 'Phone X', Software: 'secret-app' }, IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' } })
    .toBuffer();

test('photo: JPEG is re-encoded to 512×512 JPEG with all EXIF (GPS, camera) removed', async () => {
  const input = await jpegWithExif();
  assert.ok((await sharp(input).metadata()).exif, 'fixture has EXIF');
  const out = await processProfilePhoto(input);
  const meta = await sharp(out.buffer).metadata();
  assert.equal(out.mimeType, 'image/jpeg');
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);
  assert.equal(meta.exif, undefined, 'no EXIF');
  assert.equal(meta.xmp, undefined, 'no XMP');
  assert.equal(meta.iptc, undefined, 'no IPTC');
  assert.ok(!out.buffer.includes(Buffer.from('TestCam')) && !out.buffer.includes(Buffer.from('secret-app')));
});

test('photo: PNG (with transparency) is accepted and flattened to JPEG', async () => {
  const png = await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const out = await processProfilePhoto(png);
  const meta = await sharp(out.buffer).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.hasAlpha, false);
});

test('photo: content, not the name or type, decides — other formats and disguised files are refused', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(1)</script></svg>');
  const gif = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#000' } }).gif().toBuffer();
  const webp = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#000' } }).webp().toBuffer();
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);
  for (const [name, buf] of [['svg', svg], ['gif', gif], ['webp', webp], ['pdf', pdf], ['exe', exe]]) {
    await assert.rejects(processProfilePhoto(buf), (e) => e.status === 415, name);
  }
  // JPEG magic bytes followed by garbage: decoding fails → 422, nothing stored.
  const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('not really a jpeg'.repeat(10))]);
  await assert.rejects(processProfilePhoto(fake), (e) => e.status === 422);
  // A script appended after a real JPEG is discarded by re-encoding.
  const polyglot = Buffer.concat([await jpegWithExif(200, 200), Buffer.from('<?php system($_GET["c"]); ?>')]);
  const cleaned = await processProfilePhoto(polyglot);
  assert.ok(!cleaned.buffer.includes(Buffer.from('<?php')));
});

test('photo: size and pixel limits', async () => {
  assert.throws(() => checkPhotoUpload(Buffer.alloc(0)), (e) => e.status === 400);
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(MAX_PHOTO_BYTES)]);
  assert.throws(() => checkPhotoUpload(big), (e) => e.status === 413);
  const tiny = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  await assert.rejects(processProfilePhoto(tiny), (e) => e.status === 422 && e.code === 'PHOTO_DIMENSIONS');
  // A small file that declares a huge canvas (decompression bomb) is refused before decoding.
  const wide = await sharp({ create: { width: 7000, height: 70, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toBuffer();
  assert.ok(wide.length < MAX_PHOTO_BYTES);
  await assert.rejects(processProfilePhoto(wide), (e) => e.status === 422);
});

/* ------------------------------------------------------------ assigned doctor read access */

test('doctor read access: eligible statuses come from the real enum; age and summary filtering', async () => {
  const { DOCTOR_READ_STATUSES, ageOn, presentPatientSummary, isActiveConsultation } = await import('../../apps/api/src/modules/medical-history/medicalHistory.service.js');
  assert.deepEqual([...DOCTOR_READ_STATUSES], ['CONFIRMED', 'WAITING', 'IN_PROGRESS', 'COMPLETED']);
  for (const s of ['PENDING_PAYMENT', 'EXPIRED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED']) assert.equal(DOCTOR_READ_STATUSES.includes(s), false, s);

  const now = new Date('2026-11-06T12:00:00Z');
  assert.equal(ageOn(new Date('1990-11-06T00:00:00Z'), now), 36, 'birthday today');
  assert.equal(ageOn(new Date('1990-11-07T00:00:00Z'), now), 35, 'birthday tomorrow');
  assert.equal(ageOn(null, now), null);

  const patient = {
    id: 'p1', dateOfBirth: new Date('1990-01-01T00:00:00Z'), sex: 'FEMALE', emergencyName: 'Hodan', emergencyRelationship: 'Sister', emergencyPhone: '+252611112222',
    user: { fullName: 'Amina', email: 'a@x.test', phone: '+252600000000', avatarKey: 'avatars/x/y.jpg' }, addresses: [{ city: 'Hargeisa' }],
  };
  const idle = presentPatientSummary(patient, { active: false, appointmentId: 'a1', now });
  assert.deepEqual(Object.keys(idle).sort(), ['age', 'emergencyContact', 'id', 'name', 'photoUrl', 'sex']);
  assert.equal(idle.photoUrl, null, 'no photo → no URL');
  const withPhoto = presentPatientSummary({ ...patient, user: { ...patient.user, avatarUpdatedAt: new Date('2026-11-01T00:00:00Z') } }, { active: false, appointmentId: 'a1', now });
  assert.equal(withPhoto.photoUrl, `/v1/doctors/me/patients/p1/photo?appointmentId=a1&v=${Date.parse('2026-11-01T00:00:00Z')}`, 'gated doctor route, never a storage key');
  assert.equal(idle.emergencyContact, null, 'no emergency contact outside an active consultation');
  const live = presentPatientSummary(patient, { active: true, appointmentId: 'a1', now });
  assert.deepEqual(live.emergencyContact, { name: 'Hodan', relationship: 'Sister', phone: '+252611112222' });
  const text = JSON.stringify(live);
  for (const secret of ['a@x.test', '+252600000000', 'avatars/', 'Hargeisa']) assert.ok(!text.includes(secret), secret);

  assert.equal(isActiveConsultation({ status: 'IN_PROGRESS', consultation: null }), true);
  assert.equal(isActiveConsultation({ status: 'CONFIRMED', consultation: { status: 'WAITING' } }), false);
  assert.equal(isActiveConsultation({ status: 'COMPLETED', consultation: { status: 'COMPLETED' } }), false);

  assert.equal(roleHasPermission('DOCTOR', Permission.assignedPatientRecordsRead), true);
  assert.equal(roleHasPermission('PATIENT', Permission.assignedPatientRecordsRead), false);
  assert.equal(roleHasPermission('ADMIN', Permission.assignedPatientRecordsRead), false);
});
