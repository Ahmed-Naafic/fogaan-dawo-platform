// Unit tests: storage keys → buckets, local driver, Supabase driver (in-memory fake client — no network),
// signed tokens, configuration checks, staging cleanup and upload intents. No database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.JWT_ACCESS_SECRET ||= 'unit-test-secret-unit-test-secret-unit-test-secret';
const storage = await import('../../apps/api/src/adapters/storage/privateStorage.js');
const keys = await import('../../apps/api/src/adapters/storage/storageKeys.js');
const tokens = await import('../../apps/api/src/adapters/storage/storageTokens.js');
const supa = await import('../../apps/api/src/adapters/storage/supabaseDriver.js');
const intents = await import('../../apps/api/src/modules/storage/uploadIntent.service.js');

const withDir = async (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'fd-storage-unit-'));
  const prev = { dir: process.env.STORAGE_DIR, drv: process.env.STORAGE_DRIVER };
  process.env.STORAGE_DIR = dir;
  process.env.STORAGE_DRIVER = 'local';
  try {
    await fn(dir);
  } finally {
    process.env.STORAGE_DIR = prev.dir ?? '';
    if (!prev.dir) delete process.env.STORAGE_DIR;
    if (prev.drv) process.env.STORAGE_DRIVER = prev.drv;
    else delete process.env.STORAGE_DRIVER;
    rmSync(dir, { recursive: true, force: true });
  }
};

/* ------------------------------------------------------------ fake Supabase storage */
function fakeSupabase() {
  const objects = new Map(); // `${bucket}/${path}` -> { buf, created }
  const calls = [];
  const buckets = new Map();
  const from = (bucket) => ({
    async upload(path, body, opts) {
      calls.push({ op: 'upload', bucket, path, opts });
      const k = `${bucket}/${path}`;
      if (objects.has(k) && !opts?.upsert) return { error: { statusCode: '409', message: 'The resource already exists' } };
      objects.set(k, { buf: Buffer.from(body), created: new Date() });
      return { data: { path }, error: null };
    },
    async download(path) {
      const o = objects.get(`${bucket}/${path}`);
      if (!o) return { data: null, error: { statusCode: '404', message: 'Object not found' } };
      return { data: new Blob([o.buf]), error: null };
    },
    async remove(paths) {
      const removed = paths.filter((p) => objects.delete(`${bucket}/${p}`)).map((name) => ({ name }));
      return { data: removed, error: null };
    },
    async list(prefix, { search } = {}) {
      const pre = prefix ? `${bucket}/${prefix}/` : `${bucket}/`;
      const names = new Map();
      for (const [k, o] of objects) {
        if (!k.startsWith(pre)) continue;
        const rest = k.slice(pre.length);
        const name = rest.split('/')[0];
        if (search && !name.includes(search)) continue;
        names.set(name, { name, created_at: o.created.toISOString() });
      }
      return { data: [...names.values()], error: null };
    },
    async createSignedUrl(path, expiresIn, opts) {
      calls.push({ op: 'sign', bucket, path, expiresIn, opts });
      return { data: { signedUrl: `https://fake.supabase.test/storage/v1/object/sign/${bucket}/${path}?token=t&exp=${expiresIn}` }, error: null };
    },
    async createSignedUploadUrl(path) {
      calls.push({ op: 'sign-upload', bucket, path });
      return { data: { signedUrl: `https://fake.supabase.test/storage/v1/object/upload/sign/${bucket}/${path}?token=u`, token: 'u', path }, error: null };
    },
  });
  return {
    objects,
    calls,
    storage: {
      from,
      async getBucket(id) {
        return { data: buckets.get(id) ?? null };
      },
      async createBucket(id, opts) {
        buckets.set(id, { id, ...opts });
        return { error: null };
      },
      async updateBucket(id, opts) {
        buckets.set(id, { id, ...opts });
        return { error: null };
      },
    },
    buckets,
  };
}

/* ------------------------------------------------------------ keys */

test('keys map to the right private bucket; traversal and unknown prefixes are refused', () => {
  assert.equal(keys.assertKey('doctor-documents/a1/b2.pdf').bucket, 'fd-verification');
  assert.equal(keys.assertKey('avatars/a1/b2.jpg').bucket, 'fd-photos');
  assert.equal(keys.assertKey('prescriptions/a1/b2.pdf').bucket, 'fd-prescriptions');
  assert.equal(keys.assertKey('medical-documents/a1/b2.png').bucket, 'fd-medical');
  assert.equal(keys.assertKey('medical-documents/a1/b2.png').contentType, 'image/png');
  for (const bad of ['../etc/passwd.pdf', 'doctor-documents/../x.pdf', 'doctor-documents/a/B.pdf', 'other/a/b.pdf', 'avatars/a/b.exe', '/abs/x.pdf', 'avatars/a/b.jpg/']) {
    assert.throws(() => keys.assertKey(bad), bad);
  }
  assert.match(keys.newStagingKey(new Date('2026-11-07T10:00:00Z')), /^20261107\/[0-9a-f-]{36}$/);
  assert.throws(() => keys.assertStagingKey('20261107/../../x'));
});

/* ------------------------------------------------------------ local driver */

test('local driver: save, read, exists, remove; never overwrites', async () => {
  await withDir(async () => {
    const k = 'medical-documents/c1/f1.pdf';
    await storage.putPrivateObject(k, Buffer.from('%PDF-1 a'));
    assert.equal((await storage.getPrivateObject(k)).toString(), '%PDF-1 a');
    assert.equal(await storage.privateObjectExists(k), true);
    await assert.rejects(storage.putPrivateObject(k, Buffer.from('other')), (e) => e.code === 'STORAGE_OBJECT_EXISTS');
    assert.equal((await storage.getPrivateObject(k)).toString(), '%PDF-1 a', 'original kept');
    await storage.removePrivateObject(k);
    assert.equal(await storage.privateObjectExists(k), false);
  });
});

test('local driver: signed download/upload URLs carry short-lived, purpose-bound tokens', async () => {
  await withDir(async () => {
    const { url, expiresAt } = await storage.signedDownloadUrl('prescriptions/p1/x.pdf', { downloadName: 'FD-RX.pdf' });
    assert.match(url, /^\/v1\/storage\/local\/download\/[\w-]+\.[\w-]+\.[\w-]+$/);
    assert.ok(new Date(expiresAt) - Date.now() <= 61_000);
    const token = url.split('/').pop();
    assert.deepEqual((await tokens.verifyStorageToken('local-download', token)).key, 'prescriptions/p1/x.pdf');
    assert.equal(await tokens.verifyStorageToken('local-upload', token), null, 'wrong purpose');
    assert.equal(await tokens.verifyStorageToken('local-download', `${token}x`), null, 'tampered');
    const short = await tokens.signStorageToken('local-download', { key: 'k' }, -1);
    assert.equal(await tokens.verifyStorageToken('local-download', short), null, 'expired');
    const up = await storage.prepareStagingUpload();
    assert.match(up.stagingKey, /^\d{8}\/[0-9a-f-]{36}$/);
    assert.equal(up.upload.method, 'PUT');
  });
});

test('local staging: one claim wins; cleanup removes only uploads older than 24 h', async () => {
  await withDir(async (dir) => {
    const fresh = keys.newStagingKey();
    const old = keys.newStagingKey(new Date(Date.now() - 3 * 86_400_000));
    await storage.putLocalStaging(fresh, Buffer.from('a'));
    await storage.putLocalStaging(old, Buffer.from('b'));
    const past = new Date(Date.now() - 30 * 3_600_000);
    utimesSync(join(dir, '_staging', ...old.split('/')), past, past);
    assert.deepEqual(await storage.cleanupStaging(), { removed: 1, checked: 1 });
    assert.equal((await storage.readStaging(fresh)).toString(), 'a', 'recent upload kept');
    assert.equal(await storage.readStaging(old), null);
    assert.equal(await storage.claimStaging(fresh), true);
    assert.equal(await storage.claimStaging(fresh), false, 'second claim loses');
  });
});

/* ------------------------------------------------------------ Supabase driver (fake client) */

test('supabase driver: private bucket routing, no overwrite, signed URLs, staging claim and cleanup', async () => {
  const fake = fakeSupabase();
  supa.__setClientForTests(fake);
  process.env.STORAGE_DRIVER = 'supabase';
  try {
    await storage.putPrivateObject('doctor-documents/d1/v1.pdf', Buffer.from('%PDF-x'));
    await storage.putPrivateObject('avatars/u1/p1.jpg', Buffer.from([0xff, 0xd8, 0xff]));
    assert.ok(fake.objects.has('fd-verification/doctor-documents/d1/v1.pdf'));
    assert.ok(fake.objects.has('fd-photos/avatars/u1/p1.jpg'));
    const upload = fake.calls.find((c) => c.op === 'upload');
    assert.equal(upload.opts.upsert, false, 'never overwrite');
    assert.equal(upload.opts.contentType, 'application/pdf');
    await assert.rejects(storage.putPrivateObject('doctor-documents/d1/v1.pdf', Buffer.from('x')), (e) => e.code === 'STORAGE_OBJECT_EXISTS');
    assert.equal((await storage.getPrivateObject('doctor-documents/d1/v1.pdf')).toString(), '%PDF-x');
    assert.equal(await storage.privateObjectExists('doctor-documents/d1/v1.pdf'), true);
    assert.equal(await storage.privateObjectExists('doctor-documents/d1/none.pdf'), false);
    await assert.rejects(storage.getPrivateObject('prescriptions/p/missing.pdf'), (e) => e.code === 'STORAGE_NOT_FOUND' && !/fake\.supabase|missing\.pdf/.test(e.message));

    const signed = await storage.signedDownloadUrl('doctor-documents/d1/v1.pdf', { downloadName: 'licence.pdf' });
    const sign = fake.calls.find((c) => c.op === 'sign');
    assert.equal(sign.bucket, 'fd-verification');
    assert.equal(sign.expiresIn, 60, 'short-lived (60 s)');
    assert.deepEqual(sign.opts, { download: 'licence.pdf' });
    assert.match(signed.url, /^https:\/\/fake\.supabase\.test\//);

    const up = await storage.prepareStagingUpload();
    assert.equal(fake.calls.at(-1).op, 'sign-upload');
    assert.equal(fake.calls.at(-1).bucket, 'fd-staging');
    assert.match(up.upload.url, /upload\/sign\/fd-staging\//);
    fake.objects.set(`fd-staging/${up.stagingKey}`, { buf: Buffer.from('staged'), created: new Date() });
    assert.equal((await storage.readStaging(up.stagingKey)).toString(), 'staged');
    assert.equal(await storage.claimStaging(up.stagingKey), true);
    assert.equal(await storage.claimStaging(up.stagingKey), false);

    const oldKey = keys.newStagingKey(new Date(Date.now() - 2 * 86_400_000));
    fake.objects.set(`fd-staging/${oldKey}`, { buf: Buffer.from('old'), created: new Date(Date.now() - 2 * 86_400_000) });
    const freshKey = keys.newStagingKey();
    fake.objects.set(`fd-staging/${freshKey}`, { buf: Buffer.from('new'), created: new Date() });
    assert.deepEqual(await storage.cleanupStaging(), { removed: 1, checked: 1 });
    assert.ok(fake.objects.has(`fd-staging/${freshKey}`));

    const setup = await supa.ensureBuckets();
    assert.deepEqual(setup.map((r) => r.id).sort(), ['fd-medical', 'fd-photos', 'fd-prescriptions', 'fd-staging', 'fd-verification']);
    assert.ok([...fake.buckets.values()].every((b) => b.public === false && b.fileSizeLimit > 0 && b.allowedMimeTypes.length > 0), 'all buckets private with limits');
  } finally {
    supa.__setClientForTests(null);
    delete process.env.STORAGE_DRIVER;
  }
});

/* ------------------------------------------------------------ configuration */

test('configuration: supabase needs URL + key over https; the key must never be in a VITE_ variable; nothing secret is printed', () => {
  const key = 'service-role-secret-value-1234567890';
  assert.equal(storage.storageConfigProblem({}), null, 'local by default');
  assert.match(storage.storageConfigProblem({ STORAGE_DRIVER: 'ftp' }), /STORAGE_DRIVER/);
  assert.match(storage.storageConfigProblem({ STORAGE_DRIVER: 'supabase' }), /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(storage.storageConfigProblem({ STORAGE_DRIVER: 'supabase', SUPABASE_URL: 'http://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: key }), /https/);
  const leak = storage.storageConfigProblem({ STORAGE_DRIVER: 'supabase', SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: key, VITE_SUPABASE_KEY: key });
  assert.match(leak, /VITE_SUPABASE_KEY/);
  assert.ok(!leak.includes(key), 'the message names the variable, never the value');
  assert.equal(storage.storageConfigProblem({ STORAGE_DRIVER: 'supabase', SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: key }), null);
  const desc = storage.storageDescription({ STORAGE_DRIVER: 'supabase', SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: key });
  assert.equal(desc, 'Supabase Storage (project abc)');
  assert.ok(!desc.includes(key));
});

/* ------------------------------------------------------------ upload intents */

test('upload intents: declared size/type checked; finalisation bound to user, role and target; single use', async () => {
  await withDir(async () => {
    const auth = { user: { id: 'u1' }, activeRole: 'PATIENT' };
    const target = { consultationId: 'c1' };
    const base = { purpose: 'medical-document', target, meta: { category: 'LAB_RESULT', fileName: 'cbc.pdf' }, maxBytes: 1000 };
    await assert.rejects(intents.createUploadIntent(auth, { ...base, declared: { size: 0, contentType: 'application/pdf' } }), (e) => e.status === 400);
    await assert.rejects(intents.createUploadIntent(auth, { ...base, declared: { size: 1001, contentType: 'application/pdf' } }), (e) => e.status === 413);
    await assert.rejects(intents.createUploadIntent(auth, { ...base, declared: { size: 10, contentType: 'text/html' } }), (e) => e.status === 415);
    const intent = await intents.createUploadIntent(auth, { ...base, declared: { size: 10, contentType: 'application/pdf' } });
    const claims = await tokens.verifyStorageToken('upload-intent', intent.uploadToken);
    await assert.rejects(intents.consumeUploadIntent(auth, intent.uploadToken, { purpose: 'medical-document', target }), (e) => e.status === 409 && e.code === 'UPLOAD_NOT_FOUND', 'nothing uploaded yet');
    await storage.putLocalStaging(claims.stagingKey, Buffer.from('%PDF-1.4 x %%EOF'));
    for (const [who, a, t, p] of [
      ['other user', { user: { id: 'u2' }, activeRole: 'PATIENT' }, target, 'medical-document'],
      ['other role', { user: { id: 'u1' }, activeRole: 'DOCTOR' }, target, 'medical-document'],
      ['other consultation', auth, { consultationId: 'c2' }, 'medical-document'],
      ['other purpose', auth, target, 'verification-document'],
    ]) {
      await assert.rejects(intents.consumeUploadIntent(a, intent.uploadToken, { purpose: p, target: t }), (e) => e.status === 400 && e.code === 'UPLOAD_INTENT_INVALID', who);
    }
    const ok = await intents.consumeUploadIntent(auth, intent.uploadToken, { purpose: 'medical-document', target });
    assert.equal(ok.buffer.toString(), '%PDF-1.4 x %%EOF');
    assert.deepEqual(ok.meta, { category: 'LAB_RESULT', fileName: 'cbc.pdf' });
    assert.equal(await storage.readStaging(claims.stagingKey), null, 'staging removed once claimed');
    await assert.rejects(intents.consumeUploadIntent(auth, intent.uploadToken, { purpose: 'medical-document', target }), (e) => e.status === 409, 'single use');
    // Oversized staged bytes (the browser lied about the size) are refused after claiming.
    const big = await intents.createUploadIntent(auth, { ...base, declared: { size: 10, contentType: 'application/pdf' } });
    const bigClaims = await tokens.verifyStorageToken('upload-intent', big.uploadToken);
    await storage.putLocalStaging(bigClaims.stagingKey, Buffer.alloc(1001));
    await assert.rejects(intents.consumeUploadIntent(auth, big.uploadToken, { purpose: 'medical-document', target }), (e) => e.status === 413);
    assert.equal(await storage.readStaging(bigClaims.stagingKey), null, 'rejected bytes are not kept');
  });
});
