import { Router } from 'express';
import { listAllSms } from '../notifications/sms.service.js';
import * as specialtiesAdmin from './adminSpecialties.service.js';
import { z } from 'zod';
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

const specialtyBody = z.object({ nameEn: z.string().trim().min(2).max(120), nameSo: z.string().trim().min(2).max(120), description: z.string().trim().max(500).optional() }).strict();
const specialtyPatch = z
  .object({ nameEn: z.string().trim().min(2).max(120), nameSo: z.string().trim().min(2).max(120), description: z.string().trim().max(500).nullable(), isActive: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

/** /api/v1/admin/specialties — the admin-managed specialty list (settings:manage). Never deleted, only deactivated. */
export function createAdminSpecialtyRouter() {
  const router = adminRouter(Permission.settingsManage);
  router.get('/', asyncHandler(async (_req, res) => res.json({ data: await specialtiesAdmin.listSpecialties() })));
  router.post('/', requireClientHeader, validate({ body: specialtyBody }), asyncHandler(async (req, res) => res.status(201).json({ data: await specialtiesAdmin.createSpecialty({ adminUserId: req.auth.user.id, input: req.body }) })));
  router.patch('/:specialtyId', requireClientHeader, validate({ params: z.object({ specialtyId: z.string().uuid() }).strict(), body: specialtyPatch }), asyncHandler(async (req, res) => res.json({ data: await specialtiesAdmin.updateSpecialty({ adminUserId: req.auth.user.id, specialtyId: req.params.specialtyId, input: req.body }) })));
  return router;
}

/** /api/v1/admin/sms-outbox — every simulated SMS (audit:read): number, text, status, time. */
export function createAdminSmsRouter() {
  const router = adminRouter(Permission.auditRead);
  router.get('/', validate({ query: z.object({ q: z.string().trim().max(100).optional(), page: z.coerce.number().int().min(1).max(500).default(1) }).strict() }), asyncHandler(async (req, res) => res.json({ data: await listAllSms(req.validatedQuery) })));
  return router;
}

/** /api/v1/admin/settings — booking rules (settings:manage). Commission stays in Admin › Finance. */
export function createAdminSettingsRouter() {
  const router = adminRouter(Permission.settingsManage);
  router.get('/', asyncHandler(c.getSettings));
  router.put('/booking-policy', requireClientHeader, validate({ body: bookingPolicySchema }), asyncHandler(c.updateBookingPolicy));
  return router;
}
