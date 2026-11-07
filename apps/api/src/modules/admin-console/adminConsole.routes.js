import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission, requireRole } from '../../middleware/authorize.js';
import { rateLimiter } from '../../middleware/rateLimit.js';
import { requireClientHeader } from '../../middleware/requireClientHeader.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { Permission } from '../auth/auth.permissions.js';
import * as c from './adminConsole.controller.js';
import {
  adminAppointmentListQuerySchema,
  adminAppointmentParamsSchema,
  adminAuditQuerySchema,
  adminPatientListQuerySchema,
  adminPatientParamsSchema,
  bookingPolicySchema,
  reactivatePatientSchema,
  reportQuerySchema,
  suspendPatientSchema,
} from './adminConsole.validation.js';

const noStore = (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
};
const adminRouter = (permission) => {
  const router = Router();
  router.use(authenticate, requireRole('ADMIN'), requirePermission(permission), noStore);
  return router;
};

/** /api/v1/admin/patients — account administration (patients:manage). No clinical data. */
export function createAdminPatientRouter() {
  const router = adminRouter(Permission.patientsManage);
  router.get('/', validate({ query: adminPatientListQuerySchema }), asyncHandler(c.listPatients));
  router.get('/:patientId', validate({ params: adminPatientParamsSchema }), asyncHandler(c.getPatient));
  router.post('/:patientId/suspend', requireClientHeader, validate({ params: adminPatientParamsSchema, body: suspendPatientSchema }), asyncHandler(c.suspendPatient));
  router.post('/:patientId/reactivate', requireClientHeader, validate({ params: adminPatientParamsSchema, body: reactivatePatientSchema }), asyncHandler(c.reactivatePatient));
  return router;
}

/** /api/v1/admin/appointments — read-only monitoring (appointments:monitor). */
export function createAdminAppointmentRouter() {
  const router = adminRouter(Permission.appointmentsMonitor);
  router.get('/', validate({ query: adminAppointmentListQuerySchema }), asyncHandler(c.listAppointments));
  router.get('/:appointmentId', validate({ params: adminAppointmentParamsSchema }), asyncHandler(c.getAppointment));
  return router;
}

/** /api/v1/admin/reports — platform activity (reports:read). */
export function createAdminReportRouter() {
  const router = adminRouter(Permission.reportsRead);
  router.get('/overview', validate({ query: reportQuerySchema }), asyncHandler(c.reportOverview));
  router.get('/export', rateLimiter({ windowMs: 60_000, limit: 20 }), validate({ query: reportQuerySchema }), asyncHandler(c.reportExport));
  return router;
}

/** /api/v1/admin/audit-logs — platform audit trail without clinical entries (audit:read). */
export function createAdminAuditRouter() {
  const router = adminRouter(Permission.auditRead);
  router.get('/', validate({ query: adminAuditQuerySchema }), asyncHandler(c.listAuditLogs));
  return router;
}

/** /api/v1/admin/settings — booking rules (settings:manage). Commission stays in Admin › Finance. */
export function createAdminSettingsRouter() {
  const router = adminRouter(Permission.settingsManage);
  router.get('/', asyncHandler(c.getSettings));
  router.put('/booking-policy', requireClientHeader, validate({ body: bookingPolicySchema }), asyncHandler(c.updateBookingPolicy));
  return router;
}
