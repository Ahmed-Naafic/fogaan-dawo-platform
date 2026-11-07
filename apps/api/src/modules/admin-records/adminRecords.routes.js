import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission, requireRole } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { Permission } from '../auth/auth.permissions.js';
import * as service from './adminRecords.service.js';

const page = { page: z.coerce.number().int().min(1).max(10_000).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };
const prescriptionsQuery = z.object({ status: z.enum(['VALID', 'CANCELLED', 'REPLACED']).optional(), q: z.string().trim().max(80).optional(), ...page }).strict();
const documentsQuery = z
  .object({ category: z.enum(['LAB_RESULT', 'MEDICAL_REPORT', 'REFERRAL_LETTER', 'DIAGNOSTIC_REPORT', 'SCANNED_DOCUMENT', 'OTHER']).optional(), archived: z.enum(['true', 'false']).optional(), ...page })
  .strict();
const auditQuery = z.object({ entityType: z.enum(service.RECORD_AUDIT_ENTITIES).optional(), ...page }).strict();

/**
 * /api/v1/admin/medical-records — ADMIN role + medical-records:monitor. Metadata only: counts, references,
 * statuses, dates, sizes and audit events. There is deliberately no route to prescription contents,
 * document files or previews.
 */
export function createAdminRecordsRouter() {
  const router = Router();
  router.use(authenticate, requireRole('ADMIN'), requirePermission(Permission.medicalRecordsMonitor));
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  router.get('/overview', asyncHandler(async (_req, res) => res.json({ data: await service.overview() })));
  router.get('/prescriptions', validate({ query: prescriptionsQuery }), asyncHandler(async (req, res) => res.json({ data: await service.listPrescriptions(req.validatedQuery) })));
  router.get('/documents', validate({ query: documentsQuery }), asyncHandler(async (req, res) => res.json({ data: await service.listDocuments(req.validatedQuery) })));
  router.get('/audit', validate({ query: auditQuery }), asyncHandler(async (req, res) => res.json({ data: await service.listAudit(req.validatedQuery) })));
  return router;
}
