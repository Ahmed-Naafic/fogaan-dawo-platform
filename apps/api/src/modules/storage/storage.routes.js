import express, { Router } from 'express';
import { z } from 'zod';
import { getPrivateObject, putLocalStaging, storageDriverName } from '../../adapters/storage/privateStorage.js';
import { STAGING_BUCKET } from '../../adapters/storage/storageKeys.js';
import { verifyStorageToken } from '../../adapters/storage/storageTokens.js';
import { rateLimiter } from '../../middleware/rateLimit.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

/**
 * /api/v1/storage/local — the LOCAL driver's equivalent of Supabase signed URLs (development and tests).
 * Each URL carries a short-lived capability token minted by the API after it authorised (and audited) the
 * request; the token names exactly one object. With STORAGE_DRIVER=supabase these routes answer 404.
 *
 *   PUT /upload/:token     store the body as the staging object named in the token (once; ≤ 10 MB)
 *   GET /download/:token   one private object, for the token's lifetime (60 s by default)
 */
const tokenParams = z.object({ token: z.string().min(20).max(4096) }).strict();

/** Router for /api/v1/storage/local: signed upload/download URLs when the local storage driver is in use. */
export function createLocalStorageRouter() {
  const router = Router();
  const limiter = rateLimiter({ windowMs: 15 * 60_000, limit: Number.parseInt(process.env.UPLOAD_RATE_LIMIT_MAX ?? '120', 10) });
  router.use((_req, _res, next) => (storageDriverName() === 'local' ? next() : next(ApiError.notFound('Not found'))));

  router.put(
    '/upload/:token',
    limiter,
    express.raw({ type: () => true, limit: STAGING_BUCKET.maxBytes }),
    asyncHandler(async (req, res) => {
      const { token } = tokenParams.parse(req.params);
      const claims = await verifyStorageToken('local-upload', token);
      if (!claims) throw ApiError.forbidden('This upload link is invalid or has expired', undefined, 'UPLOAD_LINK_INVALID');
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw ApiError.badRequest('The file is empty', undefined, 'FILE_EMPTY');
      try {
        await putLocalStaging(claims.stagingKey, req.body);
      } catch (error) {
        if (error.code === 'EEXIST') throw ApiError.conflict('This upload link was already used', undefined, 'UPLOAD_LINK_USED');
        throw error;
      }
      res.status(201).json({ data: { uploaded: true } });
    }),
  );

  router.get(
    '/download/:token',
    limiter,
    asyncHandler(async (req, res) => {
      const { token } = tokenParams.parse(req.params);
      const claims = await verifyStorageToken('local-download', token);
      if (!claims) throw ApiError.forbidden('This download link is invalid or has expired', undefined, 'DOWNLOAD_LINK_INVALID');
      let buffer;
      try {
        buffer = await getPrivateObject(claims.key);
      } catch {
        throw ApiError.notFound('Not found');
      }
      const ext = claims.key.split('.').pop();
      const type = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' }[ext] ?? 'application/octet-stream';
      const name = String(claims.name || `document.${ext}`);
      const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
      res.set({
        'Content-Type': type,
        'Content-Length': String(buffer.length),
        'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      });
      res.end(buffer);
    }),
  );
  return router;
}
