import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission, requireRole } from '../../middleware/authorize.js';
import { rateLimiter } from '../../middleware/rateLimit.js';
import { requireClientHeader } from '../../middleware/requireClientHeader.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { Permission } from '../auth/auth.permissions.js';
import { consultationParamsSchema, emptyBodySchema } from '../consultations/consultation.validation.js';
import * as c from './prescription.controller.js';
import { cancelSchema, draftSchema, draftUpdateSchema, listQuerySchema, prescriptionParamsSchema, replaceSchema, verifyParamsSchema } from './prescription.validation.js';

const envInt = (name, fallback) => Number.parseInt(process.env[name] ?? `${fallback}`, 10);
const writeLimiter = () => rateLimiter({ windowMs: 15 * 60_000, limit: envInt('PRESCRIPTION_RATE_LIMIT_MAX', 120), message: 'Too many changes. Please wait and try again later.' });

const doctorWrite = [requireRole('DOCTOR'), requirePermission(Permission.assignedPrescriptionsWrite)];

/**
 * /api/v1/prescriptions
 *   GET    /:id            the patient's own (never drafts) or the prescribing doctor's
 *   GET    /:id/pdf        stored PDF, SHA-256 verified before it is served
 *   PATCH  /:id            edit a DRAFT (doctor)          DELETE /:id   discard a DRAFT (doctor)
 *   POST   /:id/issue      DRAFT → VALID (doctor, issuing window)
 *   POST   /:id/replace    correction: new prescription, original → REPLACED (doctor, window, reason)
 *   POST   /:id/cancel     VALID → CANCELLED (doctor, reason)
 */
export function createPrescriptionRouter() {
  const router = Router();
  const writes = writeLimiter();
  router.use(authenticate, requireRole('PATIENT', 'DOCTOR'));
  const params = validate({ params: prescriptionParamsSchema });
  router.get('/:prescriptionId', params, asyncHandler(c.get));
  router.get('/:prescriptionId/pdf', params, asyncHandler(c.pdf));
  router.patch('/:prescriptionId', writes, requireClientHeader, ...doctorWrite, validate({ params: prescriptionParamsSchema, body: draftUpdateSchema }), asyncHandler(c.updateDraft));
  router.delete('/:prescriptionId', writes, requireClientHeader, ...doctorWrite, params, asyncHandler(c.discardDraft));
  router.post('/:prescriptionId/issue', writes, requireClientHeader, ...doctorWrite, validate({ params: prescriptionParamsSchema, body: emptyBodySchema }), asyncHandler(c.issue));
  router.post('/:prescriptionId/replace', writes, requireClientHeader, ...doctorWrite, validate({ params: prescriptionParamsSchema, body: replaceSchema }), asyncHandler(c.replace));
  router.post('/:prescriptionId/cancel', writes, requireClientHeader, ...doctorWrite, validate({ params: prescriptionParamsSchema, body: cancelSchema }), asyncHandler(c.cancel));
  return router;
}

/** Added to the consultation router (/api/v1/consultations/:consultationId/…), which already authenticates. */
export function attachConsultationPrescriptionRoutes(router) {
  const writes = writeLimiter();
  router.post('/:consultationId/prescriptions', writes, requireClientHeader, ...doctorWrite, validate({ params: consultationParamsSchema, body: draftSchema }), asyncHandler(c.createDraft));
  router.get('/:consultationId/prescriptions', validate({ params: consultationParamsSchema }), asyncHandler(c.listForConsultation));
  router.get('/:consultationId/summary', validate({ params: consultationParamsSchema }), asyncHandler(c.summary));
}

/** GET /api/v1/me/prescriptions and /api/v1/me/consultation-summaries (patient). */
export function attachMyPrescriptionRoutes(router) {
  const patient = [requireRole('PATIENT'), requirePermission(Permission.ownPrescriptionsRead)];
  router.get('/prescriptions', ...patient, validate({ query: listQuerySchema }), asyncHandler(c.listMine));
  router.get('/consultation-summaries', ...patient, asyncHandler(c.listMySummaries));
}

/** GET /api/v1/doctors/me/prescriptions (doctor). */
export function attachDoctorPrescriptionRoutes(router) {
  router.get('/me/prescriptions', authenticate, ...doctorWrite, validate({ query: listQuerySchema }), asyncHandler(c.listForDoctor));
}

/** /api/v1/public/prescriptions/verify/:token — no login; strict rate limit; limited, non-clinical answer. */
export function createPublicPrescriptionRouter() {
  const router = Router();
  const limiter = rateLimiter({ windowMs: 15 * 60_000, limit: envInt('VERIFY_RATE_LIMIT_MAX', 60), message: 'Too many verification requests. Please wait and try again later.' });
  router.get('/verify/:token', limiter, validate({ params: verifyParamsSchema }), asyncHandler(c.verify));
  return router;
}
