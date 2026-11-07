import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission, requireRole } from '../../middleware/authorize.js';
import { bookingRateLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { Permission } from '../auth/auth.permissions.js';
import { mountAppointmentPaymentRoutes } from '../payments/payment.routes.js';
import * as c from './appointmentBooking.controller.js';
import { appointmentParamsSchema, bookSchema, cancelSchema, doctorCancelSchema, listQuerySchema, rescheduleSchema } from './appointmentBooking.validation.js';

/** /api/v1/appointments — the signed-in PATIENT's own bookings. */
export function createPatientAppointmentRouter() {
  const router = Router();
  router.use(authenticate, requireRole('PATIENT'), requirePermission(Permission.ownAppointmentsManage));
  router.post('/', bookingRateLimiter(), validate({ body: bookSchema }), asyncHandler(c.book));
  router.get('/', validate({ query: listQuerySchema }), asyncHandler(c.listMine));
  router.get('/:appointmentId', validate({ params: appointmentParamsSchema }), asyncHandler(c.getMine));
  router.post('/:appointmentId/cancel', bookingRateLimiter(), validate({ params: appointmentParamsSchema, body: cancelSchema }), asyncHandler(c.cancelMine));
  router.post('/:appointmentId/reschedule', bookingRateLimiter(), validate({ params: appointmentParamsSchema, body: rescheduleSchema }), asyncHandler(c.rescheduleMine));
  mountAppointmentPaymentRoutes(router, appointmentParamsSchema);
  return router;
}

/** /api/v1/doctors/me/appointments — the signed-in DOCTOR's own appointments. */
export function createDoctorAppointmentRouter() {
  const router = Router();
  router.use(authenticate, requireRole('DOCTOR'), requirePermission(Permission.doctorAppointmentsManage));
  router.get('/', validate({ query: listQuerySchema }), asyncHandler(c.listForDoctor));
  router.get('/:appointmentId', validate({ params: appointmentParamsSchema }), asyncHandler(c.getForDoctor));
  router.post('/:appointmentId/cancel', bookingRateLimiter(), validate({ params: appointmentParamsSchema, body: doctorCancelSchema }), asyncHandler(c.cancelForDoctor));
  return router;
}
