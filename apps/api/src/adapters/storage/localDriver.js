import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertKey, assertStagingKey } from './storageKeys.js';

/**
 * Local-disk driver (development, tests, and long-running hosts with persistent disks).
 * Files live under STORAGE_DIR (default <repo>/storage/private), outside the web root, never served
 * statically. Staging uploads live under <STORAGE_DIR>/_staging. Signed URLs are API routes guarded by
 * short-lived capability tokens (see storageTokens.js), so the behaviour matches the Supabase driver.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const storageRoot = () => resolve(process.env.STORAGE_DIR || join(REPO_ROOT, 'storage', 'private'));
const stagingRoot = () => join(storageRoot(), '_staging');

function inside(root, parts) {
  const full = resolve(root, ...parts);
  if (!full.startsWith(root + sep)) throw new Error('Storage key escapes the storage root');
  return full;
}
const pathFor = (key) => {
  assertKey(key);
  return inside(storageRoot(), key.split('/'));
};
const stagingPathFor = (key) => inside(stagingRoot(), assertStagingKey(key).split('/'));

export const name = 'local';

/** Never overwrites: every version is a new key. */
export async function put(key, buffer) {
  const full = pathFor(key);
  await mkdir(dirname(full), { recursive: true });
  try {
    await writeFile(full, buffer, { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw Object.assign(new Error('Storage object already exists'), { code: 'STORAGE_OBJECT_EXISTS' });
    throw error;
  }
}

/** Reads a private object from local disk as a Buffer. Throws when the key is invalid or the file is missing. */
export const get = (key) => readFile(pathFor(key));

/** Deletes a private object from local disk (missing files are ignored). */
export async function remove(key) {
  await rm(pathFor(key), { force: true });
}

/** True when a private object exists on local disk. */
export async function exists(key) {
  try {
    await stat(pathFor(key));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ staging */

/** Writes an unvalidated upload to the local staging area (never served). */
export async function putStaging(key, buffer) {
  const full = stagingPathFor(key);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, buffer, { flag: 'wx' });
}

/** Reads a staged upload (Buffer) or null when it does not exist. */
export async function getStaging(key) {
  try {
    return await readFile(stagingPathFor(key));
  } catch {
    return null;
  }
}

/** Removes a staged upload; returns true only for the caller that actually removed it (claim). */
export async function claimStaging(key) {
  try {
    await unlink(stagingPathFor(key));
    return true;
  } catch {
    return false;
  }
}

/** Staged uploads older than `cutoff` (by modification time). */
export async function listStagingOlderThan(cutoff) {
  const root = stagingRoot();
  let days = [];
  try {
    days = await readdir(root);
  } catch {
    return [];
  }
  const out = [];
  for (const day of days.filter((d) => /^\d{8}$/.test(d))) {
    for (const f of await readdir(join(root, day))) {
      const key = `${day}/${f}`;
      try {
        const st = await stat(stagingPathFor(key));
        if (st.mtime < cutoff) out.push(key);
      } catch {
        /* unexpected names are ignored */
      }
    }
  }
  return out;
}
