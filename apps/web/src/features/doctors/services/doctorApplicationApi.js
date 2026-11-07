import { apiRequest } from '@/lib/apiClient';

/** The signed-in user's own doctor application (and, once approved, their doctor profile). */

export const listSpecialties = () => apiRequest('/v1/specialties', { auth: false });

export const getMyApplication = () => apiRequest('/v1/doctor-application');

export const saveMyApplication = (data) => apiRequest('/v1/doctor-application', { method: 'PUT', body: data });

export const submitMyApplication = () => apiRequest('/v1/doctor-application/submit', { method: 'POST', body: {} });

/** Sends the file bytes as-is; the API detects the real type and ignores the browser's MIME type. */
export const uploadDocument = (documentType, file) =>
  apiRequest(`/v1/doctor-application/documents/${documentType}`, {
    method: 'POST',
    rawBody: file,
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
  });

export const downloadMyDocument = (documentId) => apiRequest(`/v1/doctor-application/documents/${documentId}/file`, { responseType: 'blob' });

export const getMyDoctorProfile = () => apiRequest('/v1/doctors/me');
