import { apiRequest } from '@/lib/apiClient';

/** The signed-in doctor's own workspace API (DOCTOR role). The server enforces every access rule. */
const qs = (params = {}) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  return q.toString() ? `?${q}` : '';
};

export const listMyPatients = (params) => apiRequest(`/v1/doctors/me/patients${qs(params)}`);
export const getMyPatient = (patientId) => apiRequest(`/v1/doctors/me/patients/${encodeURIComponent(patientId)}`);
export const myEarnings = (params) => apiRequest(`/v1/doctors/me/earnings${qs(params)}`);
