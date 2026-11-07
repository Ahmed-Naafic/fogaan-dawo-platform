import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission, requireRole } from '../../middleware/authorize.js';
import { rateLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { Permission } from '../auth/auth.permissions.js';
import * as c from './doctorWorkspace.controller.js';
import { myEarningsQuerySchema, myPatientParamsSchema, myPatientsQuerySchema } from './doctorWorkspace.validation.js';

const envInt = (name, fallback) => Number.parseInt(process.env[name] ?? `${fallback}`, 10);

/**
 * Mounted on /api/v1/doctors:
 *   GET /me/patients                 the doctor's patients (paid appointments only)
 *   GET /me/patients/:patientId      one patient + every appointment with them
 *   GET /me/earnings                 the doctor's own calculated earnings
 */
export function attachDoctorWorkspaceRoutes(router) {
  const reads = rateLimiter({ windowMs: 15 * 60_000, limit: envInt('PATIENT_RECORDS_RATE_LIMIT_MAX', 300) });
  const patients = [reads, authenticate, requireRole('DOCTOR'), requirePermission(Permission.assignedPatientRecordsRead)];
  router.get('/me/patients', ...patients, validate({ query: myPatientsQuerySchema }), asyncHandler(c.listPatients));
  router.get('/me/patients/:patientId', ...patients, validate({ params: myPatientParamsSchema }), asyncHandler(c.getPatient));
  router.get('/me/earnings', reads, authenticate, requireRole('DOCTOR'), requirePermission(Permission.ownEarningsRead), validate({ query: myEarningsQuerySchema }), asyncHandler(c.earnings));
}
