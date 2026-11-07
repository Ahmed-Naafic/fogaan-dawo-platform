import { apiRequest } from '@/lib/apiClient';

/**
 * The signed-in user's own profile data. No ids are sent: the API always acts on the session's user.
 * Email and phone are read-only (no verification flow for changes yet).
 */

export const getPatientProfile = () => apiRequest('/v1/me/profile');

/** PATCH semantics: only the keys present are changed. */
export const updatePatientProfile = (changes) => apiRequest('/v1/me/profile', { method: 'PATCH', body: changes });

/* ------------------------------------------------------------ photo */

/** The own photo is private: fetched with the access token and shown through an object URL. */
export const getMyPhoto = () => apiRequest('/v1/me/photo', { responseType: 'blob' });

/** Raw bytes; the API detects the real type, re-encodes the image and strips metadata. */
export const uploadMyPhoto = (file) =>
  apiRequest('/v1/me/photo', { method: 'PUT', rawBody: file, headers: { 'Content-Type': 'application/octet-stream' } });

export const removeMyPhoto = () => apiRequest('/v1/me/photo', { method: 'DELETE' });

/* ------------------------------------------------------------ medical history */

export const listHistory = ({ includeArchived = false } = {}) => apiRequest(`/v1/me/medical-history${includeArchived ? '?includeArchived=true' : ''}`);

export const addHistoryEntry = (entry) => apiRequest('/v1/me/medical-history', { method: 'POST', body: entry });

export const updateHistoryEntry = (entryId, changes) => apiRequest(`/v1/me/medical-history/entries/${encodeURIComponent(entryId)}`, { method: 'PATCH', body: changes });

export const archiveHistoryEntry = (entryId) => apiRequest(`/v1/me/medical-history/entries/${encodeURIComponent(entryId)}/archive`, { method: 'POST', body: {} });

/* ------------------------------------------------------------ doctor professional profile */

export const getDoctorProfile = () => apiRequest('/v1/doctors/me/profile');

export const updateDoctorProfile = (changes) => apiRequest('/v1/doctors/me/profile', { method: 'PATCH', body: changes });

/** Replaces the licence (file + new number/country) → re-verification (Option A). */
export const replaceLicence = (file, { licenceNumber, licenceCountry }) =>
  apiRequest(`/v1/doctors/me/licence?${new URLSearchParams({ licenceNumber, licenceCountry, confirm: 'true' })}`, {
    method: 'POST',
    rawBody: file,
    headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
  });

/* ------------------------------------------------------------ account security */

export const changePassword = (values) => apiRequest('/v1/auth/password', { method: 'POST', body: values });

/* ------------------------------------------------------------ assigned doctor: patient information */

/** Read-only, audited. `appointmentId` must be the doctor's own eligible appointment with this patient. */
export const getPatientInformation = (patientId, appointmentId) =>
  apiRequest(`/v1/doctors/me/patients/${encodeURIComponent(patientId)}/medical-history?appointmentId=${encodeURIComponent(appointmentId)}`);

/** The patient's photo for the assigned doctor; `photoPath` comes from the API (gated, audited). */
export const getPatientPhoto = (photoPath) => apiRequest(photoPath, { responseType: 'blob' });
