import { Router } from 'express';
import { z } from 'zod';
import { FOLLOW_UP_FEES, proposeFollowUp } from '../appointments/followUp.service.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission, requireRole } from '../../middleware/authorize.js';
import { rateLimiter } from '../../middleware/rateLimit.js';
import { requireClientHeader } from '../../middleware/requireClientHeader.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { Permission } from '../auth/auth.permissions.js';
import * as c from './consultation.controller.js';
import { attachConsultationPrescriptionRoutes } from '../prescriptions/prescription.routes.js';
import { attachConsultationDocumentRoutes } from '../medical-documents/medicalDocument.routes.js';
import { appointmentParamsSchema, consultationParamsSchema, emptyBodySchema, noteSchema } from './consultation.validation.js';

/**
 * /api/v1/consultations — video consultations for the appointment's own patient and assigned doctor.
 * Signaling itself is the WebSocket at /api/v1/consultations/signal (see consultation.signaling.js).
 */
/** Follow-up booking (requirement 12): one of the doctor's free slots and the fee choice. */
const followUpSchema = z.object({ slotId: z.string().uuid(), fee: z.enum(FOLLOW_UP_FEES) }).strict();

/** Router for /api/v1/consultations: join, ticket, state, admit, reject, leave, end, notes, follow-up, documents and prescriptions. */
export function createConsultationRouter() {
  const router = Router();
  const limiter = rateLimiter({ windowMs: 5 * 60_000, limit: Number.parseInt(process.env.CONSULTATION_RATE_LIMIT_MAX ?? '200', 10) });
  router.use(authenticate, requireRole('PATIENT', 'DOCTOR'), requirePermission(Permission.ownConsultationsJoin), limiter);

  const body = validate({ params: consultationParamsSchema, body: emptyBodySchema });
  router.post('/:appointmentId/join', requireClientHeader, validate({ params: appointmentParamsSchema, body: emptyBodySchema }), asyncHandler(c.join));
  router.post('/:consultationId/ticket', requireClientHeader, body, asyncHandler(c.ticket));
  router.get('/:consultationId', validate({ params: consultationParamsSchema }), asyncHandler(c.get));
  router.post('/:consultationId/admit', requireClientHeader, body, asyncHandler(c.admit));
  router.post('/:consultationId/reject', requireClientHeader, body, asyncHandler(c.reject));
  router.post('/:consultationId/leave', requireClientHeader, body, asyncHandler(c.leave));
  router.post('/:consultationId/end', requireClientHeader, body, asyncHandler(c.end));
  attachConsultationPrescriptionRoutes(router);
  attachConsultationDocumentRoutes(router);
  router.post('/:consultationId/follow-up', requireClientHeader, requireRole('DOCTOR'), validate({ params: consultationParamsSchema, body: followUpSchema }), asyncHandler(async (req, res) => res.status(201).json({ data: await proposeFollowUp(req.auth, req.params.consultationId, req.body) })));
  router.put('/:consultationId/note', requireClientHeader, requireRole('DOCTOR'), validate({ params: consultationParamsSchema, body: noteSchema }), asyncHandler(c.saveMyNote));
  return router;
}
