import { randomUUID } from 'node:crypto';
import { getPrivateObject, putPrivateObject, removePrivateObject } from '../../adapters/storage/privateStorage.js';
import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { processProfilePhoto } from '../../utils/imageProcessing.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';
import * as profileRepository from './profile.repository.js';

/**
 * Profile photos (patients and doctors share users.avatar_key).
 * - Upload: validated and re-encoded by processProfilePhoto (JPEG/PNG in, metadata-free JPEG out).
 * - Stored in the existing PRIVATE storage under a server-generated key (avatars/<userId>/<uuid>.jpg);
 *   every change writes a new key, the previous file is removed after the database commit.
 * - Served only through API endpoints: the owner's own photo (any role), and a doctor's photo publicly
 *   only while that doctor is listed (verified + active). Patient photos are never public.
 * - Medical attachments and verification documents use other keys and other endpoints; a photo URL
 *   can never address them (the URL carries no key, only the owner/doctor id).
 */
const avatarKeyFor = (userId) => `avatars/${userId}/${randomUUID()}.jpg`;

/**
 * Client-facing photo info; the URL (relative to the API base, e.g. "/api") is versioned so caches
 * refresh after a change. Never the key.
 */
export function photoInfo(user, { publicDoctorId = null } = {}) {
  if (!user?.avatarUpdatedAt) return { hasPhoto: false, url: null, updatedAt: null };
  const v = new Date(user.avatarUpdatedAt).getTime();
  const url = publicDoctorId ? `/v1/doctors/${publicDoctorId}/photo?v=${v}` : `/v1/me/photo?v=${v}`;
  return { hasPhoto: true, url, updatedAt: new Date(user.avatarUpdatedAt).toISOString() };
}

const discard = (key) => (key ? removePrivateObject(key).catch(() => {}) : Promise.resolve());

/** PUT /api/v1/me/photo: validates, strips metadata, resizes and stores the user's photo (replacing the old one). */
export async function uploadMyPhoto(auth, buffer, now = new Date()) {
  const image = await processProfilePhoto(buffer); // throws 413/415/422 before anything is stored
  const key = avatarKeyFor(auth.user.id);
  await putPrivateObject(key, image.buffer);
  let previousKey = null;
  let saved;
  try {
    saved = await withTransaction(async (tx) => {
      await lockRow(tx, 'users', auth.user.id);
      previousKey = (await profileRepository.findAvatar(tx, auth.user.id))?.avatarKey ?? null;
      const row = await profileRepository.setAvatar(tx, auth.user.id, { avatarKey: key, avatarUpdatedAt: now });
      await auditRepository.createAuditLog(tx, {
        actorUserId: auth.user.id,
        action: previousKey ? 'UPDATE' : 'CREATE',
        entityType: 'ProfilePhoto',
        entityId: auth.user.id,
        newValues: { mimeType: image.mimeType, width: image.width, height: image.height, bytes: image.buffer.length, replaced: Boolean(previousKey) },
      });
      return row;
    });
  } catch (error) {
    await discard(key);
    throw error;
  }
  await discard(previousKey);
  return photoInfo(saved);
}

/** DELETE /api/v1/me/photo: removes the user's photo. */
export async function removeMyPhoto(auth) {
  let previousKey = null;
  await withTransaction(async (tx) => {
    await lockRow(tx, 'users', auth.user.id);
    previousKey = (await profileRepository.findAvatar(tx, auth.user.id))?.avatarKey ?? null;
    if (!previousKey) return;
    await profileRepository.setAvatar(tx, auth.user.id, { avatarKey: null, avatarUpdatedAt: null });
    await auditRepository.createAuditLog(tx, { actorUserId: auth.user.id, action: 'DELETE', entityType: 'ProfilePhoto', entityId: auth.user.id });
  });
  await discard(previousKey);
  return photoInfo(null);
}

async function readPhoto(key) {
  try {
    return await getPrivateObject(key);
  } catch {
    throw ApiError.notFound('Photo not found');
  }
}

/** The signed-in user's own photo. */
export async function getMyPhoto(auth) {
  const row = await profileRepository.findAvatar(prisma, auth.user.id);
  if (!row?.avatarKey) throw ApiError.notFound('Photo not found');
  return { buffer: await readPhoto(row.avatarKey), mimeType: 'image/jpeg' };
}

/** Public: a listed doctor's photo only. Unlisted (pending, suspended, rejected…) doctors → 404. */
export async function getPublicDoctorPhoto(doctorId) {
  const doctor = await profileRepository.findPublicDoctorAvatar(prisma, doctorId);
  if (!doctor?.user.avatarKey) throw ApiError.notFound('Photo not found');
  return { buffer: await readPhoto(doctor.user.avatarKey), mimeType: 'image/jpeg' };
}
