import express, { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission, requireRole } from '../../middleware/authorize.js';
import { rateLimiter, uploadRateLimiter } from '../../middleware/rateLimit.js';
import { requireClientHeader } from '../../middleware/requireClientHeader.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { Permission } from '../auth/auth.permissions.js';
import { consultationParamsSchema, emptyBodySchema } from '../consultations/consultation.validation.js';
import * as service from './medicalDocument.service.js';

/* ------------------------------------------------------------ validation */

const documentParamsSchema = z.object({ documentId: z.uuid() }).strict();
const uploadQuerySchema = z
  .object({
    category: z.enum(service.DOCUMENT_CATEGORIES),
    description: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(500).optional()),
  })
  .strict();
const listQuerySchema = z.object({ includeArchived: z.enum(['true', 'false']).optional(), category: z.enum(service.DOCUMENT_CATEGORIES).optional() }).strict();
const downloadQuerySchema = z.object({ download: z.enum(['1']).optional() }).strict();
const declaredFile = {
  fileName: z.string().trim().min(1).max(300),
  size: z.number().int().positive(),
  contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
};
const finalizeSchema = z.object({ uploadToken: z.string().min(20).max(4096) }).strict();
const initiateSchema = z
  .object({ ...declaredFile, context: z.enum(['CHAT']).optional(), category: z.enum(service.DOCUMENT_CATEGORIES), description: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(500).optional()) })
  .strict();

/* ------------------------------------------------------------ controllers */

const participant = [requireRole('PATIENT', 'DOCTOR'), requirePermission(Permission.consultationDocumentsManage)];

async function upload(req, res) {
  const { category, description } = req.validatedQuery;
  let fileName = '';
  try {
    fileName = decodeURIComponent(String(req.get('x-file-name') ?? '')).slice(0, 300);
  } catch {
    fileName = '';
  }
  res.status(201).json({ data: await service.uploadDocument(req.auth, req.params.consultationId, { buffer: req.body, fileName, category, description }) });
}
async function listForConsultation(req, res) {
  res.json({ data: await service.listForConsultation(req.auth, req.params.consultationId, { includeArchived: req.validatedQuery?.includeArchived === 'true' }) });
}
async function listMine(req, res) {
  res.json({ data: await service.listMine(req.auth, { includeArchived: req.validatedQuery?.includeArchived === 'true', category: req.validatedQuery?.category }) });
}
async function get(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await service.getDocument(req.auth, req.params.documentId) });
}
async function download(req, res) {
  const { buffer, mimeType, fileName } = await service.downloadDocument(req.auth, req.params.documentId);
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  res.set({
    'Content-Type': mimeType,
    'Content-Length': String(buffer.length),
    'Content-Disposition': `${req.validatedQuery?.download === '1' ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  });
  res.end(buffer);
}
async function initiate(req, res) {
  res.status(201).json({ data: await service.initiateUpload(req.auth, req.params.consultationId, req.body) });
}
async function finalize(req, res) {
  res.status(201).json({ data: await service.finalizeUpload(req.auth, req.params.consultationId, req.body.uploadToken) });
}
async function downloadUrl(req, res) {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await service.getDownloadUrl(req.auth, req.params.documentId) });
}
async function archive(req, res) {
  res.json({ data: await service.archiveDocument(req.auth, req.params.documentId) });
}

/* ------------------------------------------------------------ routes */

/**
 * /api/v1/medical-documents/:id, /:id/download, /:id/archive — the consultation's patient or its active
 * assigned doctor only (everyone else, including administrators, gets 403/404; no file route for admins).
 */
export function createMedicalDocumentRouter() {
  const router = Router();
  router.use(authenticate, ...participant);
  const writes = rateLimiter({ windowMs: 15 * 60_000, limit: Number.parseInt(process.env.PROFILE_RATE_LIMIT_MAX ?? '60', 10) });
  router.get('/:documentId', validate({ params: documentParamsSchema }), asyncHandler(get));
  router.get('/:documentId/download', validate({ params: documentParamsSchema, query: downloadQuerySchema }), asyncHandler(download));
  router.get('/:documentId/download-url', validate({ params: documentParamsSchema }), asyncHandler(downloadUrl));
  router.post('/:documentId/archive', writes, requireClientHeader, validate({ params: documentParamsSchema, body: emptyBodySchema }), asyncHandler(archive));
  return router;
}

/** POST|GET /api/v1/consultations/:consultationId/documents (consultation router already authenticates). */
export function attachConsultationDocumentRoutes(router) {
  router.post(
    '/:consultationId/documents',
    uploadRateLimiter(),
    requireClientHeader,
    ...participant,
    validate({ params: consultationParamsSchema, query: uploadQuerySchema }),
    // Raw bytes, any Content-Type (the server detects the real type from the content).
    express.raw({ type: () => true, limit: service.MAX_MEDICAL_DOCUMENT_BYTES }),
    asyncHandler(upload),
  );
  // Large files (browser → storage): authorised initiation, then validated finalisation.
  router.post('/:consultationId/documents/upload-url', uploadRateLimiter(), requireClientHeader, ...participant, validate({ params: consultationParamsSchema, body: initiateSchema }), asyncHandler(initiate));
  router.post('/:consultationId/documents/finalize', uploadRateLimiter(), requireClientHeader, ...participant, validate({ params: consultationParamsSchema, body: finalizeSchema }), asyncHandler(finalize));
  router.get('/:consultationId/documents', ...participant, validate({ params: consultationParamsSchema, query: listQuerySchema }), asyncHandler(listForConsultation));
}

/** GET /api/v1/me/medical-documents (patient). */
export function attachMyDocumentRoutes(router) {
  router.get('/medical-documents', requireRole('PATIENT'), requirePermission(Permission.consultationDocumentsManage), validate({ query: listQuerySchema }), asyncHandler(listMine));
}
