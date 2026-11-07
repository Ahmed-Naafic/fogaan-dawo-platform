import { apiRequest } from '@/lib/apiClient';
import { fetchSignedBlob } from '@/lib/stagedFiles';

/** Administrator doctor verification (API enforces ADMIN + doctors:verify on every call). */

/** Fired after any decision so counters (e.g. the sidebar badge) refresh at once, not on the next navigation. */
export const VERIFICATION_CHANGED = 'fd:verification-changed';
const announce = (result) => {
  window.dispatchEvent(new Event(VERIFICATION_CHANGED));
  return result;
};

export const listApplications = (tab = 'pending') => apiRequest(`/v1/admin/doctor-applications?tab=${encodeURIComponent(tab)}`);

export const getApplication = (doctorId) => apiRequest(`/v1/admin/doctor-applications/${encodeURIComponent(doctorId)}`);

/** Application document as a Blob, via a short-lived signed URL (authorised + audited by the API). */
export const downloadApplicationDocument = (doctorId, documentId) =>
  fetchSignedBlob(() => apiRequest(`/v1/admin/doctor-applications/${encodeURIComponent(doctorId)}/documents/${encodeURIComponent(documentId)}/url`));

export const startReview = (doctorId) => apiRequest(`/v1/admin/doctor-applications/${encodeURIComponent(doctorId)}/start-review`, { method: 'POST', body: {} }).then(announce);

export const approve = (doctorId, notes) =>
  apiRequest(`/v1/admin/doctor-applications/${encodeURIComponent(doctorId)}/approve`, { method: 'POST', body: notes ? { notes } : {} }).then(announce);

export const reject = (doctorId, reason) => apiRequest(`/v1/admin/doctor-applications/${encodeURIComponent(doctorId)}/reject`, { method: 'POST', body: { reason } }).then(announce);
