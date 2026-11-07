// Unit tests (Phase 10): prescription lifecycle rules, issuing window, validation (1–10 items, reasons),
// PDF generation + SHA-256, QR tokens, medical-document file validation, consultation summary filtering,
// admin metadata filtering and permissions. No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Permission, roleHasPermission } from '../../apps/api/src/modules/auth/auth.permissions.js';
import { doctorSections, sharedSections } from '../../apps/api/src/modules/consultations/consultationSummary.service.js';
import { MAX_MEDICAL_DOCUMENT_BYTES, validateMedicalDocument } from '../../apps/api/src/modules/medical-documents/medicalDocument.service.js';
import { renderPrescriptionPdf } from '../../apps/api/src/modules/prescriptions/prescription.pdf.js';
import { canTransition, formatReference, issueWindow, MAX_ITEMS } from '../../apps/api/src/modules/prescriptions/prescription.policy.js';
import { hashVerificationToken, newVerificationToken, presentPrescription, sha256, verificationUrl } from '../../apps/api/src/modules/prescriptions/prescription.service.js';
import { cancelSchema, draftSchema, draftUpdateSchema, replaceSchema, verifyParamsSchema } from '../../apps/api/src/modules/prescriptions/prescription.validation.js';

const HOUR = 3_600_000;
const item = (n = 1) => ({ medicineName: `Medicine ${n}`, dose: '500 mg', frequency: 'Twice daily', duration: '5 days' });

test('lifecycle: DRAFT → VALID → CANCELLED | REPLACED; final states are final', () => {
  assert.equal(canTransition('DRAFT', 'VALID'), true);
  assert.equal(canTransition('VALID', 'CANCELLED'), true);
  assert.equal(canTransition('VALID', 'REPLACED'), true);
  for (const [from, to] of [['DRAFT', 'CANCELLED'], ['DRAFT', 'REPLACED'], ['VALID', 'DRAFT'], ['CANCELLED', 'VALID'], ['REPLACED', 'VALID'], ['CANCELLED', 'REPLACED'], ['REPLACED', 'CANCELLED'], ['VALID', 'VALID']]) {
    assert.equal(canTransition(from, to), false, `${from} → ${to}`);
  }
});

test('issuing window: during the consultation or within 24 h after completion (server clock)', () => {
  const now = new Date('2026-11-07T12:00:00Z');
  assert.equal(issueWindow({ status: 'IN_PROGRESS' }, now).open, true);
  assert.equal(issueWindow({ status: 'COMPLETED', completedAt: new Date(now - 23 * HOUR) }, now).open, true);
  const closed = issueWindow({ status: 'COMPLETED', completedAt: new Date(now - 24 * HOUR) }, now);
  assert.equal(closed.open, false);
  assert.equal(closed.reason, 'WINDOW_PASSED');
  assert.equal(issueWindow({ status: 'WAITING' }, now).open, false, 'not before the consultation starts');
  assert.equal(issueWindow({ status: 'CANCELLED' }, now).reason, 'CONSULTATION_CANCELLED');
  assert.equal(issueWindow(null, now).open, false);
});

test('validation: 1–10 medicines, bounded text, no status/ids/tokens can be sent', () => {
  assert.equal(draftSchema.safeParse({ items: [item()] }).success, true);
  assert.equal(draftSchema.safeParse({ items: [] }).success, false, 'at least one medicine');
  assert.equal(draftSchema.safeParse({ items: Array.from({ length: MAX_ITEMS }, (_, i) => item(i)) }).success, true);
  assert.equal(draftSchema.safeParse({ items: Array.from({ length: MAX_ITEMS + 1 }, (_, i) => item(i)) }).success, false, 'at most 10');
  for (const bad of [{ ...item(), medicineName: 'x' }, { ...item(), dose: '' }, { ...item(), frequency: 'x'.repeat(121) }, { ...item(), instructions: 'x'.repeat(1001) }, { ...item(), extra: 1 }]) {
    assert.equal(draftSchema.safeParse({ items: [bad] }).success, false, JSON.stringify(bad).slice(0, 60));
  }
  for (const key of ['status', 'patientId', 'doctorId', 'verificationTokenHash', 'reference', 'issuedAt', 'pdfFileKey']) {
    assert.equal(draftSchema.safeParse({ items: [item()], [key]: 'x' }).success, false, key);
  }
  assert.equal(draftUpdateSchema.safeParse({}).success, false);
  const parsed = draftSchema.parse({ items: [{ ...item(), quantity: ' ', warnings: '  Avoid alcohol ' }] });
  assert.equal(parsed.items[0].quantity, null);
  assert.equal(parsed.items[0].warnings, 'Avoid alcohol');
});

test('cancellation and replacement require a reason of at least 10 characters', () => {
  assert.equal(cancelSchema.safeParse({}).success, false);
  assert.equal(cancelSchema.safeParse({ reason: 'too short' }).success, false);
  assert.equal(cancelSchema.safeParse({ reason: 'Wrong patient selected' }).success, true);
  assert.equal(replaceSchema.safeParse({ items: [item()] }).success, false, 'replacement needs a reason');
  assert.equal(replaceSchema.safeParse({ reason: 'Dose corrected after review', items: [item()] }).success, true);
});

test('QR tokens: 256-bit random, only the SHA-256 hash is stored; verify URL points to the public page', () => {
  const a = newVerificationToken();
  const b = newVerificationToken();
  assert.notEqual(a, b);
  assert.equal(Buffer.from(a, 'base64url').length, 32);
  assert.match(hashVerificationToken(a), /^[0-9a-f]{64}$/);
  assert.notEqual(hashVerificationToken(a), a);
  process.env.WEB_APP_URL = 'https://app.example.test/';
  assert.equal(verificationUrl(a), `https://app.example.test/verify/${a}`);
  assert.equal(verifyParamsSchema.safeParse({ token: a }).success, true);
  assert.equal(verifyParamsSchema.safeParse({ token: '../../etc/passwd' }).success, false);
  assert.equal(formatReference(new Date('2026-03-01T00:00:00Z'), 123), 'FD-RX-2026-000123');
});

const rx = {
  reference: 'FD-RX-2026-000001',
  issuedAt: new Date('2026-11-07T09:30:00Z'),
  generalNotes: 'Rest and fluids.',
  replaces: null,
  patient: { user: { fullName: 'Amina Warsame' }, dateOfBirth: new Date('1990-02-01') },
  doctor: { user: { fullName: 'Dr. Hodan Axmed' }, specialty: { nameEn: 'General Practice', nameSo: 'Dhakhtar Guud' }, licenceNumber: 'SMC-1', licenceCountry: 'Somalia' },
  items: [{ ...item(), quantity: '10 tablets', instructions: 'After meals', warnings: 'Avoid alcohol' }],
};

test('PDF: real PDF from saved data, both languages, stable SHA-256 of the stored bytes', async () => {
  for (const lang of ['en', 'so']) {
    const pdf = await renderPrescriptionPdf(rx, { lang, verifyUrl: 'https://app.example.test/verify/abc' });
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.subarray(-1024).toString('latin1').includes('%%EOF'));
    assert.ok(pdf.length > 3000 && pdf.length < 200_000, `size ${pdf.length}`);
    assert.equal(sha256(pdf), sha256(Buffer.from(pdf)), 'checksum is deterministic for the stored bytes');
    assert.notEqual(sha256(pdf), sha256(Buffer.concat([pdf, Buffer.from(' ')])), 'any change is detected');
  }
  const many = await renderPrescriptionPdf({ ...rx, items: Array.from({ length: 10 }, (_, i) => ({ ...item(i), instructions: 'x '.repeat(60), warnings: 'y '.repeat(40) })) }, { lang: 'en', verifyUrl: 'https://x.test/verify/a' });
  assert.equal(many.subarray(0, 5).toString(), '%PDF-', '10 long items still render (multi-page)');
});

test('presenter: never exposes token hash, storage key or checksum; patient has no actions', () => {
  const full = {
    ...rx,
    id: 'p1',
    status: 'VALID',
    consultationId: 'c1',
    consultation: { appointmentId: 'a1' },
    verificationTokenHash: 'h'.repeat(64),
    pdfFileKey: 'prescriptions/p1/x.pdf',
    pdfSha256: 's'.repeat(64),
    items: [{ id: 'i1', ...rx.items[0], position: 0 }],
    replacedBy: null,
    createdAt: new Date(),
  };
  const asPatient = presentPrescription(full, { viewer: 'PATIENT' });
  const text = JSON.stringify(asPatient);
  for (const secret of ['h'.repeat(64), 'prescriptions/p1', 's'.repeat(64)]) assert.ok(!text.includes(secret));
  assert.equal(asPatient.hasPdf, true);
  assert.equal('actions' in asPatient, false);
  const asDoctor = presentPrescription({ ...full, status: 'DRAFT' }, { viewer: 'DOCTOR', window: { open: false, closesAt: null, reason: 'WINDOW_PASSED' } });
  assert.deepEqual(asDoctor.actions, { edit: false, issue: false, discard: true, replace: false, cancel: false }, 'no issue action outside the window');
});

test('medical documents: content decides; disguised, malformed, empty and oversized files are refused', async () => {
  const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } }).png().toBuffer();
  const jpg = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#000' } }).jpeg().toBuffer();
  const pdf = await renderPrescriptionPdf(rx, { lang: 'en', verifyUrl: 'https://x.test/verify/a' });
  assert.deepEqual(await validateMedicalDocument(png), { mime: 'image/png', ext: 'png' });
  assert.deepEqual(await validateMedicalDocument(jpg), { mime: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(await validateMedicalDocument(pdf), { mime: 'application/pdf', ext: 'pdf' });
  await assert.rejects(validateMedicalDocument(Buffer.alloc(0)), (e) => e.status === 400);
  await assert.rejects(validateMedicalDocument(Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(MAX_MEDICAL_DOCUMENT_BYTES)])), (e) => e.status === 413);
  for (const disguised of [Buffer.from('<html><script>alert(1)</script></html>'), Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]), Buffer.from('GIF89a' + 'x'.repeat(50))]) {
    await assert.rejects(validateMedicalDocument(disguised), (e) => e.status === 415);
  }
  await assert.rejects(validateMedicalDocument(Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n')), (e) => e.status === 422, 'truncated PDF');
  await assert.rejects(validateMedicalDocument(Buffer.concat([png.subarray(0, 40), Buffer.alloc(60)])), (e) => e.status === 422, 'broken PNG');
});

test('consultation summary: patients get shared, non-empty sections only; doctors see all with share state', () => {
  const note = { complaint: 'Headache', assessment: 'Tension type', diagnosis: 'Migraine', advice: 'Rest, fluids', shareComplaint: true, shareAssessment: false, shareDiagnosis: true, shareAdvice: false };
  assert.deepEqual(sharedSections(note), [{ key: 'complaint', text: 'Headache' }, { key: 'diagnosis', text: 'Migraine' }]);
  assert.deepEqual(sharedSections({ ...note, diagnosis: '   ' }).map((s) => s.key), ['complaint'], 'empty shared section omitted');
  assert.deepEqual(sharedSections(null), []);
  assert.deepEqual(sharedSections({ ...note, shareAdvice: true }).map((s) => s.key), ['complaint', 'diagnosis', 'advice']);
  const all = doctorSections(note);
  assert.equal(all.length, 4);
  assert.deepEqual(all.map((s) => s.shared), [true, false, true, false]);
});

test('permissions: doctors prescribe, patients read their own, admins monitor metadata only', () => {
  assert.equal(roleHasPermission('DOCTOR', Permission.assignedPrescriptionsWrite), true);
  assert.equal(roleHasPermission('PATIENT', Permission.assignedPrescriptionsWrite), false);
  assert.equal(roleHasPermission('ADMIN', Permission.assignedPrescriptionsWrite), false);
  assert.equal(roleHasPermission('PATIENT', Permission.ownPrescriptionsRead), true);
  assert.equal(roleHasPermission('PATIENT', Permission.consultationDocumentsManage), true);
  assert.equal(roleHasPermission('DOCTOR', Permission.consultationDocumentsManage), true);
  assert.equal(roleHasPermission('ADMIN', Permission.consultationDocumentsManage), false, 'admins never reach document files');
  assert.equal(roleHasPermission('ADMIN', Permission.medicalRecordsMonitor), true);
  assert.equal(roleHasPermission('DOCTOR', Permission.medicalRecordsMonitor), false);
});
