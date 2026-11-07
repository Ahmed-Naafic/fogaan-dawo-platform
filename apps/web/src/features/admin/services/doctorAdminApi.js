import { apiRequest } from '@/lib/apiClient';

/** Admin doctor management (API enforces ADMIN + doctors:manage on every call). */

export const listDoctors = ({ tab = 'all', q, page = 1 } = {}) =>
  apiRequest(`/v1/admin/doctors?${new URLSearchParams({ tab, page: String(page), ...(q ? { q } : {}) })}`);

export const suspendDoctor = (doctorId, reason) => apiRequest(`/v1/admin/doctors/${encodeURIComponent(doctorId)}/suspend`, { method: 'POST', body: { reason } });
