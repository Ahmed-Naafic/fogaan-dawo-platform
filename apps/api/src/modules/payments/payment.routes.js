import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission, requireRole } from '../../middleware/authorize.js';
import { bookingRateLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { Permission } from '../auth/auth.permissions.js';
import * as f from '../finance/finance.controller.js';
import { commissionSchema, earningsQuerySchema, exportQuerySchema, rangeQuerySchema, rejectRefundSchema } from '../finance/finance.validation.js';
import { rateLimiter } from '../../middleware/rateLimit.js';
import { requireClientHeader } from '../../middleware/requireClientHeader.js';
import * as c from './payment.controller.js';
import { adminPaymentQuerySchema, adminRefundQuerySchema, emptyBodySchema, payBodySchema, paymentParamsSchema, refundParamsSchema } from './payment.validation.js';

/** Routes added to /api/v1/appointments/:appointmentId (patient router — already authenticated as PATIENT). */
export function mountAppointmentPaymentRoutes(router, appointmentParamsSchema) {
  router.get('/:appointmentId/checkout', validate({ params: appointmentParamsSchema }), asyncHandler(c.checkout));
  router.post('/:appointmentId/payments', bookingRateLimiter(), validate({ params: appointmentParamsSchema, body: payBodySchema }), asyncHandler(c.pay));
  router.post('/:appointmentId/payments/refresh', validate({ params: appointmentParamsSchema, body: emptyBodySchema }), asyncHandler(c.refresh));
}

/** /api/v1/payments — the signed-in patient's payment history and demo receipts. */
export function createPatientPaymentRouter() {
  const router = Router();
  router.use(authenticate, requireRole('PATIENT'), requirePermission(Permission.ownAppointmentsManage));
  router.get('/', asyncHandler(c.myPayments));
  router.get('/:paymentId/receipt', validate({ params: paymentParamsSchema }), asyncHandler(c.myReceipt));
  return router;
}

/**
 * /api/v1/admin/finance — simulated payments, refunds, doctor earnings, reports and the commission
 * setting, for administrators acting as ADMIN (finance:manage). Writes need the X-Fogaan-Client header.
 */
export function createAdminFinanceRouter() {
  const router = Router();
  router.use(authenticate, requireRole('ADMIN'), requirePermission(Permission.financeManage));
  const exportLimiter = rateLimiter({ windowMs: 5 * 60_000, limit: 60 });
  router.get('/overview', validate({ query: rangeQuerySchema }), asyncHandler(f.overview));
  router.get('/payments', validate({ query: adminPaymentQuerySchema }), asyncHandler(f.listPayments));
  router.get('/payments/:paymentId', validate({ params: paymentParamsSchema }), asyncHandler(c.getPayment));
  router.get('/payments/:paymentId/receipt', validate({ params: paymentParamsSchema }), asyncHandler(c.adminReceipt));
  router.get('/refunds', validate({ query: adminRefundQuerySchema }), asyncHandler(f.listRefunds));
  router.get('/refunds/:refundId', validate({ params: refundParamsSchema }), asyncHandler(f.getRefund));
  router.post('/refunds/:refundId/process', validate({ params: refundParamsSchema, body: emptyBodySchema }), asyncHandler(c.processRefund));
  router.post('/refunds/:refundId/reject', requireClientHeader, validate({ params: refundParamsSchema, body: rejectRefundSchema }), asyncHandler(f.rejectRefund));
  router.post('/refunds/:refundId/retry', validate({ params: refundParamsSchema, body: emptyBodySchema }), asyncHandler(c.retryRefund));
  router.get('/doctor-earnings', validate({ query: earningsQuerySchema }), asyncHandler(f.doctorEarnings));
  router.get('/reports', validate({ query: rangeQuerySchema }), asyncHandler(f.report));
  router.get('/reports/export', exportLimiter, validate({ query: exportQuerySchema }), asyncHandler(f.exportCsv));
  router.get('/settings', asyncHandler(f.getSettings));
  router.put('/settings/commission', requireClientHeader, validate({ body: commissionSchema }), asyncHandler(f.updateCommission));
  return router;
}
