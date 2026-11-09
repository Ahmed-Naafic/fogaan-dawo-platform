import { apiRequest } from '@/lib/apiClient';

/** Admin console API: patients, appointments, activity reports, audit logs. The API enforces ADMIN + permission. */
const qs = (params = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  return q.toString() ? `?${q}` : '';
};
const enc = encodeURIComponent;

export const listPatients = (params) => apiRequest(`/v1/admin/patients${qs(params)}`);
export const getPatient = (id) => apiRequest(`/v1/admin/patients/${enc(id)}`);
export const suspendPatient = (id, reason) => apiRequest(`/v1/admin/patients/${enc(id)}/suspend`, { method: 'POST', body: { reason } });
export const reactivatePatient = (id, reason) => apiRequest(`/v1/admin/patients/${enc(id)}/reactivate`, { method: 'POST', body: reason ? { reason } : {} });

export const listAppointments = (params) => apiRequest(`/v1/admin/appointments${qs(params)}`);
export const getAppointment = (id) => apiRequest(`/v1/admin/appointments/${enc(id)}`);

export const reportOverview = (range) => apiRequest(`/v1/admin/reports/overview${qs(range)}`);
export const reportExport = (range) => apiRequest(`/v1/admin/reports/export${qs(range)}`, { responseType: 'blob' });

export const listAuditLogs = (params) => apiRequest(`/v1/admin/audit-logs${qs(params)}`);

const CODES = new Set([
  'PATIENT_ALREADY_SUSPENDED',
  'PATIENT_NOT_SUSPENDED',
  'PATIENT_ACCOUNT_PROTECTED',
  'PATIENT_IS_ACTIVE_DOCTOR',
  'SELF_ACTION_FORBIDDEN',
  'FINANCE_RANGE_INVALID',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'RATE_LIMITED',
  'NETWORK_ERROR',
  'BOOKING_POLICY_INVALID',
  'BOOKING_POLICY_UNCHANGED',
]);
export const adminConsoleErrorKey = (error) => `adminConsole.errors.${CODES.has(error?.code) ? error.code : 'GENERIC'}`;

export const getSettings = () => apiRequest('/v1/admin/settings');
export const updateBookingPolicy = (values) => apiRequest('/v1/admin/settings/booking-policy', { method: 'PUT', body: { ...values, confirm: true } });
