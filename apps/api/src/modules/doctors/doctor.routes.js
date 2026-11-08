import express, { Router } from 'express';
import { listDoctorReviews } from '../reviews/review.service.js';
import { z } from 'zod';
import { requireClientHeader } from '../../middleware/requireClientHeader.js';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission, requireRole } from '../../middleware/authorize.js';
import { availabilityRateLimiter, publicRateLimiter, uploadRateLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { MAX_DOCUMENT_BYTES } from '../../utils/fileType.js';
import { Permission } from '../auth/auth.permissions.js';
import { createDoctorAppointmentRouter } from '../appointments/appointment.routes.js';
import * as availabilityController from '../availability/availability.controller.js';
import { blockIdParamsSchema, blockSchema, ruleIdParamsSchema, scheduleSchema, slotRangeQuerySchema } from '../availability/availability.validation.js';
import * as applicationController from './doctorApplication.controller.js';
import * as doctorAdminController from './doctorAdmin.controller.js';
import { adminDoctorListQuerySchema, adminDoctorParamsSchema, suspendDoctorSchema, adminDoctorUpdateSchema } from './doctorAdmin.validation.js';
import * as directoryController from './doctorDirectory.controller.js';
import { directoryQuerySchema, publicDoctorParamsSchema, publicSlotsQuerySchema } from './doctorDirectory.validation.js';
import {
  adminListQuerySchema,
  approveSchema,
  doctorDocumentParamsSchema,
  doctorIdParamsSchema,
  documentIdParamsSchema,
  documentTypeParamsSchema,
  rejectSchema,
  saveApplicationSchema,
  startReviewSchema,
} from './doctorApplication.validation.js';
import * as verificationController from './doctorVerification.controller.js';
import { attachDoctorProfileRoutes } from '../profiles/profile.routes.js';
import { attachDoctorPrescriptionRoutes } from '../prescriptions/prescription.routes.js';
import { attachDoctorWorkspaceRoutes } from '../doctor-workspace/doctorWorkspace.routes.js';

/** GET /api/v1/specialties — public, for the application form. */
export function createSpecialtyRouter() {
  const router = Router();
  router.get('/', asyncHandler(applicationController.listSpecialties));
  return router;
}

const uploadInitiateSchema = z
  .object({ fileName: z.string().trim().min(1).max(300), size: z.number().int().positive(), contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']) })
  .strict();
const uploadFinalizeSchema = z.object({ uploadToken: z.string().min(20).max(4096) }).strict();

/** /api/v1/doctor-application — the signed-in user's OWN application only (no ids from the client). */
export function createDoctorApplicationRouter() {
  const router = Router();
  router.use(authenticate, requirePermission(Permission.ownDoctorApplicationManage));
  router.get('/', asyncHandler(applicationController.getMine));
  router.put('/', validate({ body: saveApplicationSchema }), asyncHandler(applicationController.saveMine));
  router.post('/submit', validate({ body: startReviewSchema }), asyncHandler(applicationController.submitMine));
  router.post(
    '/documents/:documentType',
    uploadRateLimiter(),
    validate({ params: documentTypeParamsSchema }),
    // Raw bytes, any Content-Type (the browser's MIME type is ignored; the server detects the type).
    express.raw({ type: () => true, limit: MAX_DOCUMENT_BYTES }),
    asyncHandler(applicationController.uploadDocument),
  );
  router.get('/documents/:documentId/file', validate({ params: documentIdParamsSchema }), asyncHandler(applicationController.downloadMine));
  router.get('/documents/:documentId/url', validate({ params: documentIdParamsSchema }), asyncHandler(applicationController.documentUrl));
  // Large files (browser → storage): authorised initiation, then validated finalisation.
  router.post('/documents/:documentType/upload-url', uploadRateLimiter(), requireClientHeader, validate({ params: documentTypeParamsSchema, body: uploadInitiateSchema }), asyncHandler(applicationController.initiateUpload));
  router.post('/documents/:documentType/finalize', uploadRateLimiter(), requireClientHeader, validate({ params: documentTypeParamsSchema, body: uploadFinalizeSchema }), asyncHandler(applicationController.finalizeUpload));
  return router;
}

/**
 * /api/v1/doctors
 *   /me, /me/availability/*  — the approved doctor acting in the DOCTOR role (own data only)
 *   /, /:doctorId, /:doctorId/slots — public directory (no login; verified + active doctors only)
 */
export function createDoctorRouter() {
  const router = Router();
  router.get('/me', authenticate, requireRole('DOCTOR'), requirePermission(Permission.ownDoctorProfileRead), asyncHandler(verificationController.myDoctorProfile));

  const own = Router();
  own.use(authenticate, requireRole('DOCTOR'), requirePermission(Permission.ownAvailabilityManage));
  own.get('/', asyncHandler(availabilityController.getMine));
  own.get('/calendar', validate({ query: slotRangeQuerySchema }), asyncHandler(availabilityController.calendar));
  own.put('/schedule', availabilityRateLimiter(), validate({ body: scheduleSchema }), asyncHandler(availabilityController.saveSchedule));
  own.delete('/rules/:ruleId', availabilityRateLimiter(), validate({ params: ruleIdParamsSchema }), asyncHandler(availabilityController.deleteRule));
  own.post('/blocks', availabilityRateLimiter(), validate({ body: blockSchema }), asyncHandler(availabilityController.addBlock));
  own.delete('/blocks/:blockId', availabilityRateLimiter(), validate({ params: blockIdParamsSchema }), asyncHandler(availabilityController.removeBlock));
  router.use('/me/availability', own);
  router.use('/me/appointments', createDoctorAppointmentRouter());

  const publicReads = publicRateLimiter();
  attachDoctorProfileRoutes(router, { publicReads });
  attachDoctorPrescriptionRoutes(router);
  attachDoctorWorkspaceRoutes(router);
  router.get('/', publicReads, validate({ query: directoryQuerySchema }), asyncHandler(directoryController.search));
  router.get('/:doctorId', publicReads, validate({ params: publicDoctorParamsSchema }), asyncHandler(directoryController.get));
  router.get('/:doctorId/reviews', publicReads, validate({ params: publicDoctorParamsSchema, query: z.object({ page: z.coerce.number().int().min(1).max(500).default(1) }).strict() }), asyncHandler(async (req, res) => res.json({ data: await listDoctorReviews(req.params.doctorId, req.validatedQuery) })));
  router.get('/:doctorId/slots', publicReads, validate({ params: publicDoctorParamsSchema, query: publicSlotsQuerySchema }), asyncHandler(directoryController.slots));
  return router;
}

/** /api/v1/admin/doctor-applications — administrators acting as ADMIN with doctors:verify. */
export function createAdminDoctorApplicationRouter() {
  const router = Router();
  router.use(authenticate, requireRole('ADMIN'), requirePermission(Permission.doctorsVerify));
  router.get('/', validate({ query: adminListQuerySchema }), asyncHandler(verificationController.list));
  router.get('/:doctorId', validate({ params: doctorIdParamsSchema }), asyncHandler(verificationController.get));
  router.get('/:doctorId/documents/:documentId/file', validate({ params: doctorDocumentParamsSchema }), asyncHandler(verificationController.downloadDocument));
  router.get('/:doctorId/documents/:documentId/url', validate({ params: doctorDocumentParamsSchema }), asyncHandler(verificationController.documentUrl));
  router.post('/:doctorId/start-review', validate({ params: doctorIdParamsSchema, body: startReviewSchema }), asyncHandler(verificationController.startReview));
  router.post('/:doctorId/approve', validate({ params: doctorIdParamsSchema, body: approveSchema }), asyncHandler(verificationController.approve));
  router.post('/:doctorId/reject', validate({ params: doctorIdParamsSchema, body: rejectSchema }), asyncHandler(verificationController.reject));
  return router;
}

/** /api/v1/admin/doctors — doctor management for administrators acting as ADMIN with doctors:manage. */
export function createAdminDoctorRouter() {
  const router = Router();
  router.use(authenticate, requireRole('ADMIN'), requirePermission(Permission.doctorsManage));
  router.get('/', validate({ query: adminDoctorListQuerySchema }), asyncHandler(doctorAdminController.list));
  router.post('/:doctorId/suspend', validate({ params: adminDoctorParamsSchema, body: suspendDoctorSchema }), asyncHandler(doctorAdminController.suspend));
  router.patch('/:doctorId', requireClientHeader, validate({ params: adminDoctorParamsSchema, body: adminDoctorUpdateSchema }), asyncHandler(doctorAdminController.update));
  return router;
}
