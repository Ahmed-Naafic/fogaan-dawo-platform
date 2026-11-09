import { apiRequest } from '@/lib/apiClient';
import { fetchSignedBlob, uploadViaStaging } from '@/lib/stagedFiles';

/** The signed-in user's own doctor application (and, once approved, their doctor profile). */

export const listSpecialties = () => apiRequest('/v1/specialties', { auth: false });

export const getMyApplication = () => apiRequest('/v1/doctor-application');

export const saveMyApplication = (data) => apiRequest('/v1/doctor-application', { method: 'PUT', body: data });

export const submitMyApplication = () => apiRequest('/v1/doctor-application/submit', { method: 'POST', body: {} });

/**
 * Uploads through a validated staging step (works with large files and on Vercel): the API authorises the
 * upload, the browser sends the bytes to storage, then the API checks the real content before recording it.
 */
export const uploadDocument = (documentType, file) =>
  uploadViaStaging(file, {
    initiate: (declared) => apiRequest(`/v1/doctor-application/documents/${documentType}/upload-url`, { method: 'POST', body: declared }),
    finalize: (uploadToken) => apiRequest(`/v1/doctor-application/documents/${documentType}/finalize`, { method: 'POST', body: { uploadToken } }),
  });

/** Own document as a Blob, fetched through a short-lived signed URL (authorised + audited by the API). */
export const downloadMyDocument = (documentId) => fetchSignedBlob(() => apiRequest(`/v1/doctor-application/documents/${documentId}/url`));

export const getMyDoctorProfile = () => apiRequest('/v1/doctors/me');
