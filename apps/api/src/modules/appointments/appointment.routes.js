import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission, requireRole } from '../../middleware/authorize.js';
import { bookingRateLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { Permission } from '../auth/auth.permissions.js';
import { mountAppointmentPaymentRoutes } from '../payments/payment.routes.js';
import { z } from 'zod';
import * as dashboard from '../dashboard/dashboard.service.js';
import * as booking from './appointmentBooking.service.js';
import * as reviews from '../reviews/review.service.js';
import { confirmFreeFollowUp } from './followUp.service.js';
import { requireClientHeader } from '../../middleware/requireClientHeader.js';
import * as c from './appointmentBooking.controller.js';
import { appointmentParamsSchema, bookSchema, cancelSchema, doctorCancelSchema, listQuerySchema, rescheduleSchema } from './appointmentBooking.validation.js';

/** /api/v1/appointments — the signed-in PATIENT's own bookings. */
export function createPatientAppointmentRouter() {
  const router = Router();
  router.use(authenticate, requireRole('PATIENT'), requirePermission(Permission.ownAppointmentsManage));
  router.post('/', bookingRateLimiter(), validate({ body: bookSchema }), asyncHandler(c.book));
  router.get('/', validate({ query: listQuerySchema }), asyncHandler(c.listMine));
  // Dashboard counts + next visit (declared before /:appointmentId).
  router.get('/summary', asyncHandler(async (req, res) => res.json({ data: await dashboard.patientSummary(req.auth) })));
  router.get('/:appointmentId', validate({ params: appointmentParamsSchema }), asyncHandler(c.getMine));
  router.post('/:appointmentId/cancel', bookingRateLimiter(), validate({ params: appointmentParamsSchema, body: cancelSchema }), asyncHandler(c.cancelMine));
  router.post('/:appointmentId/consultation-record', requireClientHeader, validate({ params: appointmentParamsSchema, body: z.object({}).strict() }), asyncHandler(async (req, res) => res.json({ data: await booking.ensureConsultationRecord(req.auth, req.params.appointmentId) })));
  router.post('/:appointmentId/confirm-free', requireClientHeader, validate({ params: appointmentParamsSchema, body: z.object({}).strict() }), asyncHandler(async (req, res) => res.json({ data: await confirmFreeFollowUp(req.auth, req.params.appointmentId) })));
  router.post('/:appointmentId/review', requireClientHeader, validate({ params: appointmentParamsSchema, body: reviewSchema }), asyncHandler(async (req, res) => res.status(201).json({ data: await reviews.rateAppointment(req.auth, req.params.appointmentId, req.body) })));
  router.post('/:appointmentId/no-show-refund', bookingRateLimiter(), requireClientHeader, validate({ params: appointmentParamsSchema, body: z.object({}).strict() }), asyncHandler(async (req, res) => res.json({ data: await booking.requestNoShowRefund(req.auth, req.params.appointmentId) })));
  router.post('/:appointmentId/reschedule', bookingRateLimiter(), validate({ params: appointmentParamsSchema, body: rescheduleSchema }), asyncHandler(c.rescheduleMine));
  mountAppointmentPaymentRoutes(router, appointmentParamsSchema);
  return router;
}

/** /api/v1/doctors/me/appointments — the signed-in DOCTOR's own appointments. */
/** Rating body: 1–5 stars and an optional comment (≤ 1000 characters). */
const reviewSchema = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() }).strict();

const summaryQuerySchema = z.object({ tz: z.string().max(64).optional() }).strict();

export function createDoctorAppointmentRouter() {
  const router = Router();
  router.use(authenticate, requireRole('DOCTOR'), requirePermission(Permission.doctorAppointmentsManage));
  router.get('/', validate({ query: listQuerySchema }), asyncHandler(c.listForDoctor));
  router.get('/summary', validate({ query: summaryQuerySchema }), asyncHandler(async (req, res) => res.json({ data: await dashboard.doctorSummary(req.auth, req.validatedQuery) })));
  router.get('/:appointmentId', validate({ params: appointmentParamsSchema }), asyncHandler(c.getForDoctor));
  router.post('/:appointmentId/cancel', bookingRateLimiter(), validate({ params: appointmentParamsSchema, body: doctorCancelSchema }), asyncHandler(c.cancelForDoctor));
  return router;
}
