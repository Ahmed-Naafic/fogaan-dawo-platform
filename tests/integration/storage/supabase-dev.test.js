// Opt-in integration test against the DEVELOPMENT Supabase project (never production).
//   npm run test:storage:supabase-dev
// Runs only when DATABASE_ENV=development and STORAGE_DRIVER=supabase (from .env.development) — otherwise
// skipped. Uses generated test files only, under a random "fd-int-test-*" folder, and removes exactly the
// objects it created. Prints no URLs, keys or secrets.
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const enabled = process.env.DATABASE_ENV === 'development' && process.env.STORAGE_DRIVER === 'supabase' && process.env.SUPABASE_URL;
const reason = 'set STORAGE_DRIVER=supabase with the DEVELOPMENT project in .env.development to run';

test('development Supabase Storage: private buckets, no overwrite, signed URLs, staging, cleanup', { skip: enabled ? false : reason }, async () => {
  const storage = await import('../../../apps/api/src/adapters/storage/privateStorage.js');
  assert.equal(storage.storageConfigProblem(), null);
  const run = `fd-int-test-${randomBytes(4).toString('hex')}`;
  const key = `medical-documents/${run}/${randomUUID()}.pdf`;
  const body = Buffer.from(`%PDF-1.4\n% generated test file ${run}\n%%EOF\n`);
  const created = [key];
  try {
    await storage.putPrivateObject(key, body);
    assert.equal(await storage.privateObjectExists(key), true);
    assert.ok((await storage.getPrivateObject(key)).equals(body));
    await assert.rejects(storage.putPrivateObject(key, Buffer.from('%PDF-overwrite %%EOF')), (e) => e.code === 'STORAGE_OBJECT_EXISTS', 'never overwrites');
    assert.ok((await storage.getPrivateObject(key)).equals(body), 'original intact');

    const { url } = await storage.signedDownloadUrl(key, { downloadName: 'test.pdf', expiresIn: 30 });
    const res = await fetch(url);
    assert.equal(res.status, 200);
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(body));
    const publicUrl = `${process.env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/fd-medical/${key}`;
    assert.notEqual((await fetch(publicUrl)).status, 200, 'bucket is not public');

    const { stagingKey, upload } = await storage.prepareStagingUpload();
    const put = await fetch(upload.url, { method: upload.method, headers: { ...upload.headers, 'Content-Type': 'application/pdf' }, body });
    assert.ok(put.ok, `staging upload status ${put.status}`);
    assert.ok((await storage.readStaging(stagingKey)).equals(body));
    assert.equal(await storage.claimStaging(stagingKey), true);
    assert.equal(await storage.claimStaging(stagingKey), false);
  } finally {
    for (const k of created) await storage.removePrivateObject(k).catch(() => {});
  }
});
