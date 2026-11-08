import { ApiError } from '../../utils/ApiError.js';
import * as finance from './financeAdmin.service.js';
import { renderDemoReceipt } from './paymentReceipt.js';
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

export const checkout = async (req, res) => res.json({ data: await sim.getCheckout(req.auth, req.params.appointmentId) });
export const pay = async (req, res) => res.json({ data: await sim.payForAppointment(req.auth, req.params.appointmentId, { ...req.body, idempotencyKey: idempotencyKey(req) }) });
export const refresh = async (req, res) => res.json({ data: await sim.refreshPayment(req.auth, req.params.appointmentId) });
export const myPayments = async (req, res) => res.json({ data: await sim.listMyPayments(req.auth) });
export const myReceipt = async (req, res) => sendPdf(res, await sim.getReceipt(req.auth, req.params.paymentId), receiptLang(req));

export const getPayment = async (req, res) => res.json({ data: await finance.getPayment(req.params.paymentId) });
export const adminReceipt = async (req, res) => sendPdf(res, await sim.getReceipt(req.auth, req.params.paymentId, { asAdmin: true }), receiptLang(req));
export const processRefund = async (req, res) => res.json({ data: await finance.processRefund({ refundId: req.params.refundId, adminUserId: req.auth.user.id }) });
export const retryRefund = async (req, res) => res.json({ data: await finance.retryRefund({ refundId: req.params.refundId, adminUserId: req.auth.user.id }) });
