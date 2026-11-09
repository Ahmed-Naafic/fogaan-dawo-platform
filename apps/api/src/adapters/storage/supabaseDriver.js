import { createClient } from '@supabase/supabase-js';
import { assertKey, assertStagingKey, BUCKETS, STAGING_BUCKET } from './storageKeys.js';

/**
 * Supabase Storage driver (object storage only — Neon stays the database). Every bucket is PRIVATE and
 * has no anon/authenticated policies: only this backend, with the service-role key, reads or writes.
 * Users never get Supabase credentials; they get a short-lived signed URL after Fogaan Dawo has
 * authorised (and audited) the request. Uploads never overwrite (`upsert: false`).
 *
 * The service-role key is read from the environment here and nowhere else; it is never logged.
 */
export const name = 'supabase';

let client = null;
let injected = null;

/** Tests inject a fake with the same `storage.from(bucket)` surface. */
export function __setClientForTests(fake) {
  injected = fake;
  client = null;
}

function storage() {
  if (injected) return injected.storage;
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase storage is not configured');
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { 'x-client-info': 'fogaan-dawo-api' } } });
  }
  return client.storage;
}

const bucketOf = (key) => assertKey(key);

function fail(error, what) {
  const status = Number(error?.statusCode ?? error?.status ?? 0);
  const msg = String(error?.message ?? '');
  if (status === 409 || /already exists|duplicate/i.test(msg)) return Object.assign(new Error('Storage object already exists'), { code: 'STORAGE_OBJECT_EXISTS' });
  if (status === 404 || /not found/i.test(msg)) return Object.assign(new Error(`Storage object not found (${what})`), { code: 'STORAGE_NOT_FOUND' });
  return Object.assign(new Error(`Storage ${what} failed`), { code: 'STORAGE_ERROR', status }); // no URLs/keys in the message
}

const toBuffer = async (data) => Buffer.from(await data.arrayBuffer());

/** Uploads a private object to its Supabase bucket (no overwrite). Throws on storage errors. */
export async function put(key, buffer) {
  const { bucket, contentType } = bucketOf(key);
  const { error } = await storage().from(bucket).upload(key, buffer, { contentType, upsert: false, cacheControl: '0' });
  if (error) throw fail(error, 'upload');
}

/** Downloads a private object from Supabase as a Buffer. Throws when missing. */
export async function get(key) {
  const { bucket } = bucketOf(key);
  const { data, error } = await storage().from(bucket).download(key);
  if (error) throw fail(error, 'download');
  return toBuffer(data);
}

/** Deletes a private object from Supabase. */
export async function remove(key) {
  const { bucket } = bucketOf(key);
  const { error } = await storage().from(bucket).remove([key]);
  if (error) throw fail(error, 'remove');
}

/** True when a private object exists in its Supabase bucket. */
export async function exists(key) {
  const { bucket } = bucketOf(key);
  const slash = key.lastIndexOf('/');
  const { data, error } = await storage().from(bucket).list(key.slice(0, slash), { search: key.slice(slash + 1), limit: 1 });
  if (error) throw fail(error, 'list');
  return (data ?? []).some((o) => o.name === key.slice(slash + 1));
}

/** Short-lived signed download URL; `downloadName` sets Content-Disposition (safe display name). */
export async function signedDownloadUrl(key, { expiresIn, downloadName }) {
  const { bucket } = bucketOf(key);
  const { data, error } = await storage().from(bucket).createSignedUrl(key, expiresIn, downloadName ? { download: downloadName } : undefined);
  if (error || !data?.signedUrl) throw fail(error, 'sign');
  return data.signedUrl;
}

/* ------------------------------------------------------------ staging */

/** Signed upload URL to one random staging path (the URL carries a one-path upload token). */
export async function signedStagingUpload(key) {
  assertStagingKey(key);
  const { data, error } = await storage().from(STAGING_BUCKET.bucket).createSignedUploadUrl(key);
  if (error || !data?.signedUrl) throw fail(error, 'sign-upload');
  return { url: data.signedUrl, method: 'PUT', headers: { 'x-upsert': 'false' } };
}

/** Downloads a staged upload from the staging bucket, or null when it does not exist. */
export async function getStaging(key) {
  assertStagingKey(key);
  const { data, error } = await storage().from(STAGING_BUCKET.bucket).download(key);
  if (error) return null;
  return toBuffer(data);
}

/** Removes a staged upload; true only if this call removed it (so concurrent finalisations cannot both win). */
export async function claimStaging(key) {
  assertStagingKey(key);
  const { data, error } = await storage().from(STAGING_BUCKET.bucket).remove([key]);
  if (error) throw fail(error, 'claim');
  return Array.isArray(data) && data.length === 1;
}

/** Staging keys whose day folder is older than `cutoff` (for the cleanup job). */
export async function listStagingOlderThan(cutoff) {
  const out = [];
  const { data: days, error } = await storage().from(STAGING_BUCKET.bucket).list('', { limit: 1000 });
  if (error) throw fail(error, 'list');
  for (const day of (days ?? []).map((d) => d.name).filter((n) => /^\d{8}$/.test(n))) {
    const { data: files, error: e2 } = await storage().from(STAGING_BUCKET.bucket).list(day, { limit: 1000 });
    if (e2) throw fail(e2, 'list');
    for (const f of files ?? []) {
      const created = new Date(f.created_at ?? f.updated_at ?? 0);
      if (created < cutoff) out.push(`${day}/${f.name}`);
    }
  }
  return out;
}

/** Bucket definitions for the development setup script (private; size and type limits). */
export const BUCKET_DEFINITIONS = Object.freeze([...Object.values(BUCKETS), STAGING_BUCKET].map((b) => ({ id: b.bucket, maxBytes: b.maxBytes, types: b.types })));

/**
 * Development setup: creates any missing bucket as PRIVATE with its size/type limits, and corrects an
 * existing bucket that is public or has different limits. Never deletes buckets or objects.
 */
export async function ensureBuckets() {
  const st = storage();
  const results = [];
  for (const b of BUCKET_DEFINITIONS) {
    const options = { public: false, fileSizeLimit: b.maxBytes, allowedMimeTypes: b.types };
    const { data: existing } = await st.getBucket(b.id);
    if (!existing) {
      const { error } = await st.createBucket(b.id, options);
      if (error) throw fail(error, `create bucket ${b.id}`);
      results.push({ id: b.id, action: 'created' });
    } else {
      const { error } = await st.updateBucket(b.id, options);
      if (error) throw fail(error, `update bucket ${b.id}`);
      results.push({ id: b.id, action: existing.public ? 'made private' : 'verified' });
    }
  }
  return results;
}
