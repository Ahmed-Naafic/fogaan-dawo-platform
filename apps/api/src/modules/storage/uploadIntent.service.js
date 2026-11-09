import { claimStaging, prepareStagingUpload, readStaging, UPLOAD_INTENT_TTL_SECONDS } from '../../adapters/storage/privateStorage.js';
import { signStorageToken, verifyStorageToken } from '../../adapters/storage/storageTokens.js';
import { ApiError } from '../../utils/ApiError.js';

/**
 * Direct (browser → storage) uploads for large files, in two authorised API steps:
 *
 *   1. initiate: the owning service has already authorised the caller; here the declared size/type are
 *      checked and a random staging path + signed upload URL are issued, together with a signed
 *      "upload intent" token describing exactly what may be finalised (who, where, category, file name).
 *   2. finalise: the token must belong to the same user, role and target; the staged bytes are read and
 *      CLAIMED (removed from staging — only one finalisation can win), then returned to the owning service,
 *      which validates the real bytes (type from content, structure, size, SHA-256) before storing them
 *      in the final private bucket and creating the database record.
 *
 * Unvalidated staging objects are never served to anyone and are deleted after 24 hours (cleanupStaging).
 */
export const UploadErrorCode = Object.freeze({
  intentInvalid: 'UPLOAD_INTENT_INVALID',
  notUploaded: 'UPLOAD_NOT_FOUND',
  alreadyFinalised: 'UPLOAD_ALREADY_FINALISED',
  tooLarge: 'PAYLOAD_TOO_LARGE',
  typeNotAllowed: 'FILE_TYPE_NOT_ALLOWED',
});

const DECLARABLE_TYPES = Object.freeze(['application/pdf', 'image/jpeg', 'image/png']);

/**
 * @param purpose  'medical-document' | 'verification-document'
 * @param target   ids the finalisation must match (e.g. { consultationId } or { doctorId, documentType })
 * @param meta     what the owning service stores (category, description, file name) — validated by it
 */
export async function createUploadIntent(auth, { purpose, target, meta, declared, maxBytes }) {
  if (!Number.isInteger(declared.size) || declared.size <= 0) throw ApiError.badRequest('The file is empty', undefined, 'FILE_EMPTY');
  if (declared.size > maxBytes) throw new ApiError(413, `The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`, undefined, UploadErrorCode.tooLarge);
  if (!DECLARABLE_TYPES.includes(declared.contentType)) throw new ApiError(415, 'Only PDF, JPEG or PNG files are accepted', undefined, UploadErrorCode.typeNotAllowed);
  const { stagingKey, upload, expiresAt } = await prepareStagingUpload();
  const uploadToken = await signStorageToken('upload-intent', { purpose, userId: auth.user.id, role: auth.activeRole, target, meta, stagingKey, maxBytes }, UPLOAD_INTENT_TTL_SECONDS);
  return { uploadToken, upload, expiresAt, maxBytes };
}

/** Returns { buffer, meta } for a matching intent, after claiming the staged object. */
export async function consumeUploadIntent(auth, uploadToken, { purpose, target }) {
  const claims = await verifyStorageToken('upload-intent', uploadToken);
  const matches =
    claims &&
    claims.purpose === purpose &&
    claims.userId === auth.user.id &&
    claims.role === auth.activeRole &&
    Object.entries(target).every(([k, v]) => claims.target?.[k] === v);
  if (!matches) throw ApiError.badRequest('This upload cannot be finalised here', undefined, UploadErrorCode.intentInvalid);

  const buffer = await readStaging(claims.stagingKey);
  if (!buffer) throw ApiError.conflict('The file was not uploaded, has expired, or was already finalised', undefined, UploadErrorCode.notUploaded);
  if (!(await claimStaging(claims.stagingKey))) throw ApiError.conflict('This upload was already finalised', undefined, UploadErrorCode.alreadyFinalised);
  if (buffer.length > claims.maxBytes) throw new ApiError(413, 'The uploaded file is larger than allowed', undefined, UploadErrorCode.tooLarge);
  return { buffer, meta: claims.meta ?? {} };
}
