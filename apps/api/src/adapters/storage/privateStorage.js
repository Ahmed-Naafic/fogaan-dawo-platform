import * as localDriver from './localDriver.js';
import { newStagingKey } from './storageKeys.js';
import { signStorageToken } from './storageTokens.js';
import * as supabaseDriver from './supabaseDriver.js';

/**
 * Private object storage facade — the ONLY storage entry point for services.
 *
 *   STORAGE_DRIVER=local     files on disk under STORAGE_DIR (default; development and tests)
 *   STORAGE_DRIVER=supabase  Supabase Storage private buckets (object storage only; Neon stays the DB)
 *
 * Callers keep using put/get/remove with the same server-generated keys. Downloads of large files use a
 * short-lived signed URL issued only after the calling service has authorised and audited the request;
 * large uploads go to a random staging path and only become records after the API validates the bytes.
 */
export const DOWNLOAD_URL_TTL_SECONDS = 60;
export const UPLOAD_INTENT_TTL_SECONDS = 2 * 60 * 60; // matches Supabase signed-upload validity
export const STAGING_MAX_AGE_HOURS = 24;

export function storageDriverName() {
  return process.env.STORAGE_DRIVER === 'supabase' ? 'supabase' : 'local';
}
const driver = () => (storageDriverName() === 'supabase' ? supabaseDriver : localDriver);

/**
 * Configuration problems (names only, never values). The API refuses to start with STORAGE_DRIVER=supabase
 * if the URL/key are missing or if the service-role key leaks into a browser-visible variable.
 */
export function storageConfigProblem(env = process.env) {
  const drv = env.STORAGE_DRIVER ?? 'local';
  if (!['local', 'supabase'].includes(drv)) return 'STORAGE_DRIVER must be "local" or "supabase"';
  if (drv === 'local') return null;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return 'STORAGE_DRIVER=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY';
  let url;
  try {
    url = new URL(env.SUPABASE_URL);
  } catch {
    return 'SUPABASE_URL is not a valid URL';
  }
  if (url.protocol !== 'https:') return 'SUPABASE_URL must use https';
  if (env.SUPABASE_SERVICE_ROLE_KEY.length < 20) return 'SUPABASE_SERVICE_ROLE_KEY looks invalid';
  const leaked = Object.entries(env).filter(([k, v]) => k.startsWith('VITE_') && v && String(v).includes(env.SUPABASE_SERVICE_ROLE_KEY)).map(([k]) => k);
  if (leaked.length) return `The Supabase service-role key must never be in browser variables (${leaked.join(', ')})`;
  return null;
}

/** Safe, non-secret description for startup logs (driver and Supabase project ref only). */
export function storageDescription(env = process.env) {
  if ((env.STORAGE_DRIVER ?? 'local') !== 'supabase') return 'local disk';
  try {
    return `Supabase Storage (project ${new URL(env.SUPABASE_URL).hostname.split('.')[0]})`;
  } catch {
    return 'Supabase Storage (misconfigured)';
  }
}

/* ------------------------------------------------------------ objects (unchanged contract) */

/** Stores a new object; never overwrites (throws code STORAGE_OBJECT_EXISTS). */
export const putPrivateObject = (key, buffer) => driver().put(key, buffer);
export const getPrivateObject = (key) => driver().get(key);
/** Only used to clean up a file whose database record could not be created. */
export const removePrivateObject = (key) => driver().remove(key);
export const privateObjectExists = (key) => driver().exists(key);

/**
 * Short-lived URL for one object. Call ONLY after authorising and auditing the request.
 * Returns { url, expiresAt } — `url` is absolute (Supabase) or relative to the API base (local driver).
 */
export async function signedDownloadUrl(key, { downloadName, expiresIn = DOWNLOAD_URL_TTL_SECONDS } = {}) {
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  if (storageDriverName() === 'supabase') return { url: await supabaseDriver.signedDownloadUrl(key, { expiresIn, downloadName }), expiresAt };
  const token = await signStorageToken('local-download', { key, name: downloadName ?? null }, expiresIn);
  return { url: `/v1/storage/local/download/${token}`, expiresAt };
}

/* ------------------------------------------------------------ staging (large uploads) */

/**
 * Prepares a direct upload to a new random staging path. Returns { stagingKey, upload: { url, method,
 * headers }, expiresAt }. The staged bytes are never served; they become a record only after the
 * owning service validates them (finalisation).
 */
export async function prepareStagingUpload() {
  const stagingKey = newStagingKey();
  const expiresAt = new Date(Date.now() + UPLOAD_INTENT_TTL_SECONDS * 1000).toISOString();
  if (storageDriverName() === 'supabase') return { stagingKey, upload: await supabaseDriver.signedStagingUpload(stagingKey), expiresAt };
  const token = await signStorageToken('local-upload', { stagingKey }, UPLOAD_INTENT_TTL_SECONDS);
  return { stagingKey, upload: { url: `/v1/storage/local/upload/${token}`, method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' } }, expiresAt };
}

/** Local driver only: stores the body of a local signed upload. */
export const putLocalStaging = (stagingKey, buffer) => localDriver.putStaging(stagingKey, buffer);

/** Bytes of a staged upload, or null if it is missing (expired, cleaned up or already finalised). */
export const readStaging = (stagingKey) => driver().getStaging(stagingKey);

/** Removes a staged upload; true only for the single caller that removed it. */
export const claimStaging = (stagingKey) => driver().claimStaging(stagingKey);

/** Deletes staged uploads older than STAGING_MAX_AGE_HOURS. Returns the number removed. */
export async function cleanupStaging({ now = new Date(), maxAgeHours = STAGING_MAX_AGE_HOURS } = {}) {
  const cutoff = new Date(now.getTime() - maxAgeHours * 3_600_000);
  const keys = await driver().listStagingOlderThan(cutoff);
  let removed = 0;
  for (const k of keys) if (await driver().claimStaging(k)) removed += 1;
  return { removed, checked: keys.length };
}
