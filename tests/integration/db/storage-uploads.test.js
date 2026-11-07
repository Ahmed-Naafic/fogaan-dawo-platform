// Storage flows (local driver) — real HTTP API against an isolated per-run schema on the development branch:
// staged uploads (authorise → PUT to staging → validated finalisation), single-use and concurrent
// finalisation, disguised files, signed download URLs (authorised + audited, short-lived, tamper-proof),
// doctor verification documents with SHA-256, and staging cleanup. Generated test files only.
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { databaseTestsSkipReason, setupTestDatabase } from './harness.js';
import { baseData } from './fixtures.js';

const skip = databaseTestsSkipReason();
const PASSWORD = 'Correct-horse-42';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
const sha = (b) => createHash('sha256').update(b).digest('hex');

describe('storage: staged uploads and signed downloads (development branch, local driver)', { skip: skip ?? false }, () => {
  let db;
  let prisma;
  let ctx;
  let server;
  let base;
  let hashPassword;
  let storage;
  let seq = 0;
  let admin;

  before(async () => {
    process.env.JWT_ACCESS_SECRET = randomBytes(48).toString('base64url');
    process.env.BCRYPT_ROUNDS = '10';
    process.env.COOKIE_SECURE = 'false';
    process.env.UPLOAD_RATE_LIMIT_MAX = '10000';
    process.env.PROFILE_RATE_LIMIT_MAX = '10000';
    process.env.CONSULTATION_RATE_LIMIT_MAX = '10000';
    process.env.STORAGE_DRIVER = 'local';
    process.env.STORAGE_DIR = mkdtempSync(join(tmpdir(), 'fd-storage-db-'));
    db = await setupTestDatabase();
    prisma = db.prisma;
    ctx = await baseData(prisma);
    ({ hashPassword } = await import('../../../apps/api/src/utils/password.js'));
    storage = await import('../../../apps/api/src/adapters/storage/privateStorage.js');
    const { createApp } = await import('../../../apps/api/src/app.js');
    server = createApp({ authRateLimit: { limit: 10_000 } }).listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
    admin = await account('ADMIN');
  });

  after(async () => {
    await new Promise((r) => (server ? server.close(r) : r()));
    await db?.teardown();
    rmSync(process.env.STORAGE_DIR, { recursive: true, force: true });
  });

  async function api(method, path, { body, raw, token, headers = {}, absolute = false } = {}) {
    const res = await fetch(absolute ? path : base + path, {
      method,
      headers: { 'x-fogaan-client': 'native', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    let json = null;
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      json = null;
    }
    return { status: res.status, body: json, buf, headers: res.headers };
  }
  const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;
  const login = async (email, role) => (await api('POST', '/api/v1/auth/login', { body: { email, password: PASSWORD, role } })).body?.data?.accessToken;
  async function account(role, extra = {}) {
    const email = `st-${role.toLowerCase()}-${uniq()}@example.test`;
    const roles = role === 'DOCTOR' ? ['PATIENT', 'DOCTOR'] : [role];
    const user = await prisma.user.create({ data: { email, fullName: `St ${uniq()}`, passwordHash: await hashPassword(PASSWORD), roles: { create: roles.map((r) => ({ roleId: ctx.roles[r].id })) }, ...extra } });
    let profile = null;
    if (role !== 'ADMIN') profile = await prisma.patientProfile.create({ data: { userId: user.id } });
    let doctor = null;
    if (role === 'DOCTOR') doctor = await prisma.doctorProfile.create({ data: { userId: user.id, specialtyId: ctx.specialty.id, licenceNumber: `L-${uniq()}`, licenceCountry: 'Somalia', consultationFee: '20.00', verificationStatus: 'VERIFIED', verifiedAt: new Date() } });
    return { user, profile, doctor, email, token: await login(email, role) };
  }
  let slotN = 0;
  async function consultation(patient, doctor) {
    slotN += 1;
    const startAtUtc = new Date(Date.now() - 20 * 86_400_000 - slotN * 3_600_000);
    const slot = await prisma.availabilitySlot.create({ data: { doctorId: doctor.doctor.id, startAtUtc, endAtUtc: new Date(startAtUtc.getTime() + 30 * 60_000), timeZoneSnapshot: 'Africa/Mogadishu', status: 'BOOKED' } });
    const appointment = await prisma.appointment.create({ data: { patientId: patient.profile.id, doctorId: doctor.doctor.id, slotId: slot.id, status: 'COMPLETED', feeAmount: '20.00', commissionRateSnapshot: '0.1500', startAtUtc, endAtUtc: slot.endAtUtc } });
    return prisma.consultation.create({ data: { appointmentId: appointment.id, patientId: patient.profile.id, doctorId: doctor.doctor.id, status: 'COMPLETED', startedAt: startAtUtc, completedAt: new Date(Date.now() - 86_400_000) } });
  }
  const initiate = (token, cid, file = PDF, extra = {}) =>
    api('POST', `/api/v1/consultations/${cid}/documents/upload-url`, { token, body: { fileName: 'cbc results.pdf', size: file.length, contentType: 'application/pdf', category: 'LAB_RESULT', description: 'Full blood count', ...extra } });
  const putTo = (upload, raw) => api(upload.method, `/api${upload.url}`, { raw, headers: upload.headers });
  const finalize = (token, cid, uploadToken) => api('POST', `/api/v1/consultations/${cid}/documents/finalize`, { token, body: { uploadToken } });
  const stagingFiles = () => {
    try {
      return readdirSync(join(process.env.STORAGE_DIR, '_staging'), { recursive: true }).filter((f) => /[0-9a-f-]{36}$/.test(String(f))).length;
    } catch {
      return 0;
    }
  };

  test('medical document: authorised slot → staging upload → validated finalisation (SHA-256, single use)', async () => {
    const p = await account('PATIENT');
    const d = await account('DOCTOR');
    const c = await consultation(p, d);

    const slot = await initiate(p.token, c.id);
    assert.equal(slot.status, 201, JSON.stringify(slot.body));
    const { uploadToken, upload, maxBytes } = slot.body.data;
    assert.equal(maxBytes, 10 * 1024 * 1024);
    assert.match(upload.url, /^\/v1\/storage\/local\/upload\//);
    assert.equal((await finalize(p.token, c.id, uploadToken)).status, 409, 'nothing uploaded yet');
    assert.equal((await putTo(upload, PDF)).status, 201);
    assert.equal((await putTo(upload, PDF)).status, 409, 'an upload link works once');
    assert.equal(stagingFiles(), 1);

    const done = await finalize(p.token, c.id, uploadToken);
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.equal(done.body.data.category, 'LAB_RESULT');
    assert.equal(done.body.data.fileName, 'cbc results.pdf');
    const row = await prisma.consultationAttachment.findUniqueOrThrow({ where: { id: done.body.data.id } });
    assert.equal(row.sha256, sha(PDF));
    assert.match(row.fileKey, /^medical-documents\/[0-9a-f-]+\/[0-9a-f-]+\.pdf$/, 'final key is server-generated, not the file name');
    assert.equal(stagingFiles(), 0, 'staging removed after finalisation');
    assert.equal((await finalize(p.token, c.id, uploadToken)).status, 409, 'cannot finalise twice');
    assert.equal(await prisma.consultationAttachment.count({ where: { consultationId: c.id } }), 1);
  });

  test('only participants can start uploads; tokens are bound to the user, role and consultation', async () => {
    const p = await account('PATIENT');
    const q = await account('PATIENT');
    const d = await account('DOCTOR');
    const other = await account('DOCTOR');
    const c = await consultation(p, d);
    const c2 = await consultation(q, d);
    assert.equal((await initiate(q.token, c.id)).status, 404, 'another patient');
    assert.equal((await initiate(other.token, c.id)).status, 404, 'unassigned doctor');
    assert.equal((await initiate(admin.token, c.id)).status, 403, 'administrator');
    assert.equal((await initiate(p.token, c.id, PDF, { contentType: 'text/html' })).status, 400, 'declared type validated');
    assert.equal((await initiate(p.token, c.id, PDF, { size: 11 * 1024 * 1024 })).status, 413, 'declared size validated');

    const slot = (await initiate(p.token, c.id)).body.data;
    await putTo(slot.upload, PDF);
    assert.equal((await finalize(q.token, c.id, slot.uploadToken)).status, 404, 'another patient cannot even reach finalisation');
    assert.equal((await finalize(p.token, c2.id, slot.uploadToken)).status, 404, 'other consultation');
    const docToken = (await api('POST', `/api/v1/consultations/${c.id}/documents/finalize`, { token: d.token, body: { uploadToken: slot.uploadToken } })).body;
    assert.equal(docToken.error.code, 'UPLOAD_INTENT_INVALID', 'the doctor cannot finalise the patient’s upload');
    assert.equal((await finalize(p.token, c.id, slot.uploadToken)).status, 201);
  });

  test('disguised or broken files are refused at finalisation and never kept', async () => {
    const p = await account('PATIENT');
    const d = await account('DOCTOR');
    const c = await consultation(p, d);
    for (const [label, raw, status] of [
      ['html disguised as pdf', Buffer.from('<html><script>alert(1)</script></html>'), 415],
      ['executable', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300)]), 415],
      ['truncated pdf', Buffer.from('%PDF-1.4 no end'), 422],
      ['broken png', Buffer.concat([(await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } }).png().toBuffer()).subarray(0, 40), Buffer.alloc(80)]), 422],
    ]) {
      const slot = (await initiate(p.token, c.id, raw)).body.data;
      await putTo(slot.upload, raw);
      assert.equal((await finalize(p.token, c.id, slot.uploadToken)).status, status, label);
    }
    assert.equal(await prisma.consultationAttachment.count({ where: { consultationId: c.id } }), 0);
    assert.equal(stagingFiles(), 0, 'refused bytes were removed from staging');
    assert.equal(readdirSync(process.env.STORAGE_DIR).includes('medical-documents') ? readdirSync(join(process.env.STORAGE_DIR, 'medical-documents')).includes(c.id) : false, false, 'nothing stored in the final bucket');
  });

  test('concurrent finalisations of one upload: exactly one document is created', async () => {
    const p = await account('PATIENT');
    const d = await account('DOCTOR');
    const c = await consultation(p, d);
    const slot = (await initiate(p.token, c.id)).body.data;
    await putTo(slot.upload, PDF);
    const results = await Promise.all([finalize(p.token, c.id, slot.uploadToken), finalize(p.token, c.id, slot.uploadToken), finalize(p.token, c.id, slot.uploadToken)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
    assert.equal(await prisma.consultationAttachment.count({ where: { consultationId: c.id } }), 1);
  });

  test('signed download URLs: participants only, audited, short-lived, tamper-proof', async () => {
    const p = await account('PATIENT');
    const d = await account('DOCTOR');
    const other = await account('DOCTOR');
    const c = await consultation(p, d);
    const slot = (await initiate(p.token, c.id)).body.data;
    await putTo(slot.upload, PDF);
    const doc = (await finalize(p.token, c.id, slot.uploadToken)).body.data;

    const signed = await api('GET', `/api/v1/medical-documents/${doc.id}/download-url`, { token: d.token });
    assert.equal(signed.status, 200, JSON.stringify(signed.body));
    assert.equal(signed.headers.get('cache-control'), 'private, no-store');
    assert.ok(new Date(signed.body.data.expiresAt) - Date.now() <= 61_000, 'expires within a minute');
    const file = await api('GET', `/api${signed.body.data.url}`);
    assert.equal(file.status, 200);
    assert.ok(file.buf.equals(PDF));
    assert.match(file.headers.get('content-disposition'), /attachment; filename="cbc results.pdf"/);
    assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await api('GET', `/api${signed.body.data.url}x`)).status, 403, 'tampered link');
    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'MedicalDocument', entityId: doc.id, newValues: { path: ['action'], equals: 'SIGNED_URL_ISSUED' } } });
    assert.ok(audit && audit.actorUserId === d.user.id, 'issuance audited with the actor');
    assert.equal((await api('GET', `/api/v1/medical-documents/${doc.id}/download-url`, { token: other.token })).status, 404);
    assert.equal((await api('GET', `/api/v1/medical-documents/${doc.id}/download-url`, { token: admin.token })).status, 403);
    assert.equal((await api('GET', `/api/v1/medical-documents/${doc.id}/download-url`)).status, 401);
  });

  test('doctor verification documents: staged upload stores SHA-256; applicant and admin get audited signed URLs', async () => {
    const applicant = await account('PATIENT');
    await api('PUT', '/api/v1/doctor-application', {
      token: applicant.token,
      body: { professionalName: `Dr. Staged ${uniq()}`, specialtyId: ctx.specialty.id, licenceNumber: `SMC-${uniq()}`, licenceCountry: 'Somalia', consultationFee: 20, bio: 'General practitioner with eight years of experience in community clinics.', languages: ['so'] },
    });
    const slot = await api('POST', '/api/v1/doctor-application/documents/MEDICAL_LICENSE/upload-url', { token: applicant.token, body: { fileName: 'licence.pdf', size: PDF.length, contentType: 'application/pdf' } });
    assert.equal(slot.status, 201, JSON.stringify(slot.body));
    assert.equal((await api('POST', '/api/v1/doctor-application/documents/MEDICAL_LICENSE/upload-url', { token: applicant.token, body: { fileName: 'big.pdf', size: 6 * 1024 * 1024, contentType: 'application/pdf' } })).status, 413, '5 MB limit');
    await putTo(slot.body.data.upload, PDF);
    assert.equal((await api('POST', '/api/v1/doctor-application/documents/IDENTITY_PROOF/finalize', { token: applicant.token, body: { uploadToken: slot.body.data.uploadToken } })).status, 400, 'bound to the document type');
    const done = await api('POST', '/api/v1/doctor-application/documents/MEDICAL_LICENSE/finalize', { token: applicant.token, body: { uploadToken: slot.body.data.uploadToken } });
    assert.equal(done.status, 201, JSON.stringify(done.body));
    const row = await prisma.doctorDocument.findUniqueOrThrow({ where: { id: done.body.data.id } });
    assert.equal(row.sha256, sha(PDF), 'checksum recorded');

    const own = await api('GET', `/api/v1/doctor-application/documents/${row.id}/url`, { token: applicant.token });
    assert.equal(own.status, 200);
    assert.ok((await api('GET', `/api${own.body.data.url}`)).buf.equals(PDF));
    const stranger = await account('PATIENT');
    assert.equal((await api('GET', `/api/v1/doctor-application/documents/${row.id}/url`, { token: stranger.token })).status, 404);

    await api('POST', '/api/v1/doctor-application/submit', { token: applicant.token, body: {} });
    const adminUrl = await api('GET', `/api/v1/admin/doctor-applications/${row.doctorId}/documents/${row.id}/url`, { token: admin.token });
    assert.equal(adminUrl.status, 200, JSON.stringify(adminUrl.body));
    assert.ok(await prisma.auditLog.findFirst({ where: { entityType: 'DoctorDocument', entityId: row.id, actorUserId: admin.user.id, newValues: { path: ['action'], equals: 'SIGNED_URL_ISSUED' } } }));
    assert.equal((await api('GET', `/api/v1/admin/doctor-applications/${row.doctorId}/documents/${row.id}/url`, { token: applicant.token })).status, 403);
  });

  test('local storage routes are disabled under the Supabase driver; abandoned staging is cleaned up', async () => {
    const p = await account('PATIENT');
    const d = await account('DOCTOR');
    const c = await consultation(p, d);
    const slot = (await initiate(p.token, c.id)).body.data;
    process.env.STORAGE_DRIVER = 'supabase';
    try {
      assert.equal((await putTo(slot.upload, PDF)).status, 404);
    } finally {
      process.env.STORAGE_DRIVER = 'local';
    }
    assert.equal((await putTo(slot.upload, PDF)).status, 201);
    assert.deepEqual(await storage.cleanupStaging({ now: new Date(Date.now() + 25 * 3_600_000) }), { removed: 1, checked: 1 }, 'older than 24 h → removed');
    assert.equal((await finalize(p.token, c.id, slot.uploadToken)).status, 409, 'a cleaned-up upload cannot be finalised');
  });
});
