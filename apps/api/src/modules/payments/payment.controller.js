import { ApiError } from '../../utils/ApiError.js';
import * as finance from './financeAdmin.service.js';
import { renderDemoReceipt, renderRefundReceipt } from './paymentReceipt.js';
import * as sim from './paymentSimulation.service.js';
import { idempotencyHeaderSchema } from './payment.validation.js';

/** Thin controllers for simulated payments (patients) and the admin finance dashboard. */

function idempotencyKey(req) {
  const parsed = idempotencyHeaderSchema.safeParse(req.get('idempotency-key') ?? '');
  if (!parsed.success) throw ApiError.badRequest('An Idempotency-Key header is required for payments', [{ path: 'Idempotency-Key', message: 'Required (8–100 characters)' }], 'VALIDATION_ERROR');
  return `${req.auth.user.id}:${parsed.data}`; // scoped to the user, so keys can never collide across accounts
}

/** Receipt language: ?lang=en|so, else the reader's preferred language. */
const receiptLang = (req) => (['en', 'so'].includes(req.query?.lang) ? req.query.lang : req.auth?.user?.preferredLanguage === 'so' ? 'so' : 'en');

function sendPdf(res, payment, lang = 'en') {
  const pdf = renderDemoReceipt(payment, { lang });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="fogaan-dawo-demo-receipt-${payment.reference}.pdf"`);
  res.setHeader('Content-Length', pdf.length);
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.end(pdf);
}

/** GET /:appointmentId/checkout — checkout. Thin HTTP adapter: validated input in, service result out as JSON. */
export const checkout = async (req, res) => res.json({ data: await sim.getCheckout(req.auth, req.params.appointmentId) });
/** POST /:appointmentId/payments — pay. Thin HTTP adapter: validated input in, service result out as JSON. */
export const pay = async (req, res) => res.json({ data: await sim.payForAppointment(req.auth, req.params.appointmentId, { ...req.body, idempotencyKey: idempotencyKey(req) }) });
/** POST /:appointmentId/payments/refresh — refresh. Thin HTTP adapter: validated input in, service result out as JSON. */
export const refresh = async (req, res) => res.json({ data: await sim.refreshPayment(req.auth, req.params.appointmentId) });
/** GET /api/v1/payments — my payments. Thin HTTP adapter: validated input in, service result out as JSON. */
export const myPayments = async (req, res) => res.json({ data: await sim.listMyPayments(req.auth) });
/** GET /api/v1/payments/:paymentId/receipt — my receipt. Thin HTTP adapter: validated input in, service result out as JSON. */
export const myReceipt = async (req, res) => sendPdf(res, await sim.getReceipt(req.auth, req.params.paymentId), receiptLang(req));

/** GET /api/v1/admin/finance/payments/:paymentId — get payment. Thin HTTP adapter: validated input in, service result out as JSON. */
export const getPayment = async (req, res) => res.json({ data: await finance.getPayment(req.params.paymentId) });
/** GET /api/v1/admin/finance/payments/:paymentId/receipt — admin receipt. Thin HTTP adapter: validated input in, service result out as JSON. */
export const adminReceipt = async (req, res) => sendPdf(res, await sim.getReceipt(req.auth, req.params.paymentId, { asAdmin: true }), receiptLang(req));
/** POST /api/v1/admin/finance/refunds/:refundId/process — process refund. Thin HTTP adapter: validated input in, service result out as JSON. */
export const processRefund = async (req, res) => res.json({ data: await finance.processRefund({ refundId: req.params.refundId, adminUserId: req.auth.user.id }) });
/** POST /api/v1/admin/finance/refunds/:refundId/retry — retry refund. Thin HTTP adapter: validated input in, service result out as JSON. */
export const retryRefund = async (req, res) => res.json({ data: await finance.retryRefund({ refundId: req.params.refundId, adminUserId: req.auth.user.id }) });

/** Sends a refund receipt PDF (attachment, sandboxed). */
function sendRefundPdf(res, { payment, refund }, lang) {
  const pdf = renderRefundReceipt(payment, refund, { lang });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="fogaan-dawo-refund-receipt-${refund.id.slice(0, 8)}.pdf"`);
  res.setHeader('Content-Length', pdf.length);
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.end(pdf);
}

/** GET /api/v1/payments/:paymentId/refunds/:refundId/receipt — the patient's refund receipt (?lang=en|so). */
export const myRefundReceipt = async (req, res) => sendRefundPdf(res, await sim.getRefundReceipt(req.auth, req.params.paymentId, req.params.refundId), receiptLang(req));

/** GET /api/v1/admin/finance/payments/:paymentId/refunds/:refundId/receipt — any refund receipt (ADMIN). */
export const adminRefundReceipt = async (req, res) =>
  sendRefundPdf(res, await sim.getRefundReceipt(req.auth, req.params.paymentId, req.params.refundId, { asAdmin: true }), receiptLang(req));

