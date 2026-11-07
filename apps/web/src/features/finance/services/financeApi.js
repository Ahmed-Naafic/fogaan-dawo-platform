import { apiRequest } from '@/lib/apiClient';

/** Admin finance API (ADMIN + finance:manage). Every figure is computed on the server from stored records. */
const qs = (params = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  return q.toString() ? `?${q}` : '';
};
const base = '/v1/admin/finance';
const enc = encodeURIComponent;

export const overview = (range) => apiRequest(`${base}/overview${qs(range)}`);
export const payments = (params) => apiRequest(`${base}/payments${qs(params)}`);
export const payment = (id) => apiRequest(`${base}/payments/${enc(id)}`);
export const receipt = (id) => apiRequest(`${base}/payments/${enc(id)}/receipt`, { responseType: 'blob' });
export const refunds = (params) => apiRequest(`${base}/refunds${qs(params)}`);
export const refund = (id) => apiRequest(`${base}/refunds/${enc(id)}`);
export const approveRefund = (id) => apiRequest(`${base}/refunds/${enc(id)}/process`, { method: 'POST', body: {} });
export const rejectRefund = (id, reason) => apiRequest(`${base}/refunds/${enc(id)}/reject`, { method: 'POST', body: { reason } });
export const retryRefund = (id) => apiRequest(`${base}/refunds/${enc(id)}/retry`, { method: 'POST', body: {} });
export const doctorEarnings = (params) => apiRequest(`${base}/doctor-earnings${qs(params)}`);
export const report = (range) => apiRequest(`${base}/reports${qs(range)}`);
export const exportCsv = (params) => apiRequest(`${base}/reports/export${qs(params)}`, { responseType: 'blob' });
export const settings = () => apiRequest(`${base}/settings`);
export const updateCommission = (percent) => apiRequest(`${base}/settings/commission`, { method: 'PUT', body: { percent: String(percent), confirm: true } });
