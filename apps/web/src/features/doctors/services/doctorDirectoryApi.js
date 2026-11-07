import { apiRequest } from '@/lib/apiClient';

/** Public doctor directory (no login needed). Only verified, active doctors are ever returned. */

const query = (params) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const searchDoctors = (params) => apiRequest(`/v1/doctors${query(params)}`, { auth: false });

export const getDoctor = (doctorId) => apiRequest(`/v1/doctors/${encodeURIComponent(doctorId)}`, { auth: false });

/** Open slots grouped by date in `tz` (the zone the viewer is looking in). */
export const getDoctorSlots = (doctorId, { from, days = 7, tz } = {}) => apiRequest(`/v1/doctors/${encodeURIComponent(doctorId)}/slots${query({ from, days, tz })}`, { auth: false });
