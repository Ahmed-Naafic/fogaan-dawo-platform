import { apiRequest } from '@/lib/apiClient';

/** Dashboard summaries — every figure comes from the API (no sample data). */
export const patientSummary = () => apiRequest('/v1/appointments/summary');
export const doctorSummary = (tz) => apiRequest(`/v1/doctors/me/appointments/summary${tz ? `?tz=${encodeURIComponent(tz)}` : ''}`);
export const publicStats = () => apiRequest('/v1/public/stats');

/** The viewer's IANA time zone (falls back to the server default when unavailable). */
export const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
};
