import sharp from 'sharp';
import { ApiError } from './ApiError.js';
import { detectDocumentType } from './fileType.js';

/**
 * Profile photo processing. Defence in depth:
 *   1. size cap (2 MB) before anything is parsed;
 *   2. type from the file's own leading bytes — JPEG or PNG only (the browser's name/MIME are ignored,
 *      and formats libvips could otherwise open — SVG, TIFF, HEIF, GIF, WebP… — never reach it);
 *   3. libvips header check: the decoded format must match the magic bytes, pixel dimensions bounded
 *      (decompression-bomb guard via limitInputPixels and explicit width/height limits);
 *   4. full decode + re-encode to a fresh baseline JPEG: EXIF/XMP/IPTC/ICC metadata (GPS, camera
 *      make/model, timestamps, thumbnails) is not carried over, orientation is applied to the pixels,
 *      and anything appended to or hidden in the original file is discarded.
 * The stored file is always image/jpeg with a server-generated key.
 */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export const MAX_PHOTO_DIMENSION = 6000; // per side
export const MAX_PHOTO_PIXELS = 24_000_000; // 24 MP
export const MIN_PHOTO_DIMENSION = 64;
export const PHOTO_OUTPUT_SIZE = 512;

export const PhotoErrorCode = Object.freeze({
  empty: 'FILE_EMPTY',
  tooLarge: 'PAYLOAD_TOO_LARGE',
  type: 'PHOTO_TYPE_NOT_ALLOWED',
  invalid: 'PHOTO_INVALID',
  dimensions: 'PHOTO_DIMENSIONS',
});

const FORMAT_FOR_MIME = Object.freeze({ 'image/jpeg': 'jpeg', 'image/png': 'png' });

/** Cheap checks that need no decoding. Returns the detected { mime, ext }. */
export function checkPhotoUpload(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw ApiError.badRequest('The file is empty', undefined, PhotoErrorCode.empty);
  if (buffer.length > MAX_PHOTO_BYTES) throw new ApiError(413, 'The photo is larger than 2 MB', undefined, PhotoErrorCode.tooLarge);
  const type = detectDocumentType(buffer);
  if (!type || !FORMAT_FOR_MIME[type.mime]) throw new ApiError(415, 'Only JPEG or PNG photos are accepted', undefined, PhotoErrorCode.type);
  return type;
}

/** Validates and re-encodes a photo. Returns { buffer, mimeType: 'image/jpeg', width, height }. */
export async function processProfilePhoto(buffer) {
  const type = checkPhotoUpload(buffer);
  const options = { limitInputPixels: MAX_PHOTO_PIXELS, failOn: 'error', sequentialRead: true };
  let meta;
  try {
    meta = await sharp(buffer, options).metadata();
  } catch {
    throw new ApiError(422, 'The photo could not be read', undefined, PhotoErrorCode.invalid);
  }
  if (meta.format !== FORMAT_FOR_MIME[type.mime]) throw new ApiError(415, 'Only JPEG or PNG photos are accepted', undefined, PhotoErrorCode.type);
  const { width = 0, height = 0 } = meta;
  if (width < MIN_PHOTO_DIMENSION || height < MIN_PHOTO_DIMENSION || width > MAX_PHOTO_DIMENSION || height > MAX_PHOTO_DIMENSION || (meta.pages ?? 1) > 1) {
    throw new ApiError(422, `The photo must be between ${MIN_PHOTO_DIMENSION} and ${MAX_PHOTO_DIMENSION} pixels on each side`, undefined, PhotoErrorCode.dimensions);
  }
  try {
    const { data, info } = await sharp(buffer, options)
      .rotate() // apply EXIF orientation to the pixels; the orientation tag itself is dropped
      .resize(PHOTO_OUTPUT_SIZE, PHOTO_OUTPUT_SIZE, { fit: 'cover', position: 'attention' })
      .flatten({ background: '#ffffff' }) // PNG transparency → white
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true }); // no withMetadata(): output carries no EXIF/XMP/IPTC/ICC
    return { buffer: data, mimeType: 'image/jpeg', width: info.width, height: info.height };
  } catch {
    throw new ApiError(422, 'The photo could not be processed', undefined, PhotoErrorCode.invalid);
  }
}
