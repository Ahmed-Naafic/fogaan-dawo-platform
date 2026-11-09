import { apiRequest } from '@/lib/apiClient';

/** SIMULATED payments. The browser sends a method and wallet; the server decides the outcome. */

export const getCheckout = (appointmentId) => apiRequest(`/v1/appointments/${encodeURIComponent(appointmentId)}/checkout`);

/** One attempt; `key` is a fresh random Idempotency-Key per attempt (a double click reuses it). */
export const pay = (appointmentId, { provider, wallet }, key) =>
  apiRequest(`/v1/appointments/${encodeURIComponent(appointmentId)}/payments`, { method: 'POST', body: { provider, wallet }, headers: { 'Idempotency-Key': key } });

export const refreshPayment = (appointmentId) => apiRequest(`/v1/appointments/${encodeURIComponent(appointmentId)}/payments/refresh`, { method: 'POST', body: {} });

export const listMyPayments = () => apiRequest('/v1/payments');

/** A refund receipt PDF (Blob) for one of the patient's refunds. */
export const downloadMyRefundReceipt = (paymentId, refundId, lang = 'en') =>
  apiRequest(`/v1/payments/${encodeURIComponent(paymentId)}/refunds/${encodeURIComponent(refundId)}/receipt?lang=${lang === 'so' ? 'so' : 'en'}`, { responseType: 'blob' });
export const downloadMyReceipt = (paymentId, lang = 'en') => apiRequest(`/v1/payments/${encodeURIComponent(paymentId)}/receipt?lang=${lang === 'so' ? 'so' : 'en'}`, { responseType: 'blob' });

/** Admin finance (ADMIN + finance:manage). */
const qs = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, String(v));
  return q.toString() ? `?${q}` : '';
};
export const financeOverview = () => apiRequest('/v1/admin/finance/overview');
export const financePayments = (params) => apiRequest(`/v1/admin/finance/payments${qs(params)}`);
export const financePayment = (id) => apiRequest(`/v1/admin/finance/payments/${encodeURIComponent(id)}`);
export const financeReceipt = (id, lang = 'en') => apiRequest(`/v1/admin/finance/payments/${encodeURIComponent(id)}/receipt?lang=${lang === 'so' ? 'so' : 'en'}`, { responseType: 'blob' });
export const financeRefunds = (params) => apiRequest(`/v1/admin/finance/refunds${qs(params)}`);
export const processRefund = (id) => apiRequest(`/v1/admin/finance/refunds/${encodeURIComponent(id)}/process`, { method: 'POST', body: {} });
export const retryRefund = (id) => apiRequest(`/v1/admin/finance/refunds/${encodeURIComponent(id)}/retry`, { method: 'POST', body: {} });
