import express, { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission, requireRole } from '../../middleware/authorize.js';
import { rateLimiter, uploadRateLimiter } from '../../middleware/rateLimit.js';
import { requireClientHeader } from '../../middleware/requireClientHeader.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { MAX_DOCUMENT_BYTES } from '../../utils/fileType.js';
import { MAX_PHOTO_BYTES } from '../../utils/imageProcessing.js';
import { Permission } from '../auth/auth.permissions.js';
import * as c from './profile.controller.js';
import { attachMyPrescriptionRoutes } from '../prescriptions/prescription.routes.js';
import { attachMyDocumentRoutes } from '../medical-documents/medicalDocument.routes.js';
import {
  doctorPatientParamsSchema,
  doctorPatientPhotoQuerySchema,
  doctorPatientQuerySchema,
  doctorProfileSchema,
  emptyBodySchema,
  entryIdParamsSchema,
  historyEntryCreateSchema,
  historyEntryUpdateSchema,
  historyListQuerySchema,
  licenceReplaceQuerySchema,
  patientProfileSchema,
  publicDoctorPhotoParamsSchema,
} from './profile.validation.js';

const envInt = (name, fallback) => Number.parseInt(process.env[name] ?? `${fallback}`, 10);

/** Profile and medical-history writes: 60 per 15 minutes per IP by default (PROFILE_RATE_LIMIT_MAX). */
const profileWriteLimiter = () =>
  rateLimiter({ windowMs: 15 * 60_000, limit: envInt('PROFILE_RATE_LIMIT_MAX', 60), message: 'Too many changes. Please wait and try again later.' });

/** Photos: the file is the raw body (any Content-Type — the server detects the type from the bytes). */
const rawPhoto = express.raw({ type: () => true, limit: MAX_PHOTO_BYTES });
const rawDocument = express.raw({ type: () => true, limit: MAX_DOCUMENT_BYTES });

/**
 * /api/v1/me — the signed-in user's OWN profile data. No user, patient or entry owner id is ever
 * accepted from the client; every service resolves ownership from req.auth.
 *   GET|PATCH /profile                         patient profile (PATIENT role)
 *   GET|PUT|DELETE /photo                      own profile photo (any role)
 *   GET|POST /medical-history, PATCH /medical-history/entries/:id, POST …/:id/archive (PATIENT role)
 */
export function createMeRouter() {
  const router = Router();
  const writes = profileWriteLimiter();
  router.use(authenticate);

  const patient = [requireRole('PATIENT'), requirePermission(Permission.ownProfileRead)];
  router.get('/profile', ...patient, asyncHandler(c.getPatientProfile));
  router.patch('/profile', writes, requireClientHeader, ...patient, validate({ body: patientProfileSchema }), asyncHandler(c.updatePatientProfile));

  router.get('/photo', asyncHandler(c.getMyPhoto));
  router.put('/photo', uploadRateLimiter(), requireClientHeader, rawPhoto, asyncHandler(c.uploadPhoto));
  router.delete('/photo', writes, requireClientHeader, asyncHandler(c.removePhoto));

  const history = Router();
  history.use(requireRole('PATIENT'), requirePermission(Permission.ownMedicalHistoryManage));
  history.get('/', validate({ query: historyListQuerySchema }), asyncHandler(c.listHistory));
  history.post('/', writes, requireClientHeader, validate({ body: historyEntryCreateSchema }), asyncHandler(c.addHistoryEntry));
  history.patch('/entries/:entryId', writes, requireClientHeader, validate({ params: entryIdParamsSchema, body: historyEntryUpdateSchema }), asyncHandler(c.updateHistoryEntry));
  history.post('/entries/:entryId/archive', writes, requireClientHeader, validate({ params: entryIdParamsSchema, body: emptyBodySchema }), asyncHandler(c.archiveHistoryEntry));
  router.use('/medical-history', history);
  attachMyPrescriptionRoutes(router);
  attachMyDocumentRoutes(router);
  return router;
}

/**
 * Mounted on /api/v1/doctors (before the public /:doctorId routes):
 *   GET|PATCH /me/profile     verified doctor's professional profile (DOCTOR role)
 *   POST /me/licence          replace licence → Option A re-verification
 *   GET /:doctorId/photo      public photo of a listed doctor
 *   GET /me/patients/:patientId/medical-history?appointmentId=…   assigned doctor, read-only, audited
 *   GET /me/patients/:patientId/photo?appointmentId=…             assigned doctor, same rule, audited
 */
export function attachDoctorProfileRoutes(router, { publicReads }) {
  const own = [authenticate, requireRole('DOCTOR'), requirePermission(Permission.ownDoctorProfileManage)];
  router.get('/me/profile', ...own, asyncHandler(c.getDoctorProfile));
  router.patch('/me/profile', profileWriteLimiter(), requireClientHeader, ...own, validate({ body: doctorProfileSchema }), asyncHandler(c.updateDoctorProfile));
  router.post('/me/licence', uploadRateLimiter(), requireClientHeader, ...own, validate({ query: licenceReplaceQuerySchema }), rawDocument, asyncHandler(c.replaceLicence));
  const patientReads = rateLimiter({ windowMs: 15 * 60_000, limit: envInt('PATIENT_RECORDS_RATE_LIMIT_MAX', 300) });
  router.get(
    '/me/patients/:patientId/medical-history',
    patientReads,
    authenticate,
    requireRole('DOCTOR'),
    requirePermission(Permission.assignedPatientRecordsRead),
    validate({ params: doctorPatientParamsSchema, query: doctorPatientQuerySchema }),
    asyncHandler(c.getPatientInformationForDoctor),
  );
  router.get(
    '/me/patients/:patientId/photo',
    patientReads,
    authenticate,
    requireRole('DOCTOR'),
    requirePermission(Permission.assignedPatientRecordsRead),
    validate({ params: doctorPatientParamsSchema, query: doctorPatientPhotoQuerySchema }),
    asyncHandler(c.getPatientPhotoForDoctor),
  );
  router.get('/:doctorId/photo', publicReads, validate({ params: publicDoctorPhotoParamsSchema }), asyncHandler(c.getPublicDoctorPhoto));
}
