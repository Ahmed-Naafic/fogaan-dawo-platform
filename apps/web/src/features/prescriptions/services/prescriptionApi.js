import { apiRequest } from '@/lib/apiClient';
import { fetchSignedBlob, uploadViaStaging } from '@/lib/stagedFiles';

/** Prescriptions, consultation summaries and medical documents. Every rule is enforced by the API. */

/* ------------------------------------------------------------ prescriptions */

export const listMyPrescriptions = ({ status, page = 1, pageSize } = {}) =>
  apiRequest(`/v1/me/prescriptions?${new URLSearchParams({ ...(status ? { status } : {}), page: String(page), ...(pageSize ? { pageSize: String(pageSize) } : {}) })}`);

/** The patient's completed consultations with counts only (summary text comes from the summary route). */
export const listMySummaries = () => apiRequest('/v1/me/consultation-summaries');

export const listDoctorPrescriptions = ({ status, page = 1 } = {}) => apiRequest(`/v1/doctors/me/prescriptions?${new URLSearchParams({ ...(status ? { status } : {}), page: String(page) })}`);

export const listConsultationPrescriptions = (consultationId) => apiRequest(`/v1/consultations/${encodeURIComponent(consultationId)}/prescriptions`);

export const getPrescription = (id) => apiRequest(`/v1/prescriptions/${encodeURIComponent(id)}`);

export const createDraft = (consultationId, body) => apiRequest(`/v1/consultations/${encodeURIComponent(consultationId)}/prescriptions`, { method: 'POST', body });

export const updateDraft = (id, body) => apiRequest(`/v1/prescriptions/${encodeURIComponent(id)}`, { method: 'PATCH', body });

export const discardDraft = (id) => apiRequest(`/v1/prescriptions/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const issuePrescription = (id) => apiRequest(`/v1/prescriptions/${encodeURIComponent(id)}/issue`, { method: 'POST', body: {} });

export const replacePrescription = (id, body) => apiRequest(`/v1/prescriptions/${encodeURIComponent(id)}/replace`, { method: 'POST', body });

export const cancelPrescription = (id, reason) => apiRequest(`/v1/prescriptions/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { reason } });

/** The stored, checksum-verified PDF (private: fetched with the session, never a public link). */
export const getPrescriptionPdf = (id) => apiRequest(`/v1/prescriptions/${encodeURIComponent(id)}/pdf`, { responseType: 'blob' });

/** Public QR check (no login): validity, status, issue date, doctor — nothing clinical. */
export const verifyPrescription = (token) => apiRequest(`/v1/public/prescriptions/verify/${encodeURIComponent(token)}`, { auth: false });

/* ------------------------------------------------------------ consultation summary */

export const getConsultationSummary = (consultationId) => apiRequest(`/v1/consultations/${encodeURIComponent(consultationId)}/summary`);

/* ------------------------------------------------------------ medical documents */

export const listConsultationDocuments = (consultationId, { includeArchived = false } = {}) =>
  apiRequest(`/v1/consultations/${encodeURIComponent(consultationId)}/documents${includeArchived ? '?includeArchived=true' : ''}`);

export const listMyDocuments = ({ includeArchived = false } = {}) => apiRequest(`/v1/me/medical-documents${includeArchived ? '?includeArchived=true' : ''}`);

/**
 * Up to 10 MB: authorised upload slot → bytes straight to private staging storage → the API validates the
 * real content (type, structure, size, SHA-256) before the document is recorded.
 */
export const uploadDocument = (consultationId, file, { category, description }) =>
  uploadViaStaging(file, {
    initiate: (declared) => apiRequest(`/v1/consultations/${encodeURIComponent(consultationId)}/documents/upload-url`, { method: 'POST', body: { ...declared, category, ...(description ? { description } : {}) } }),
    finalize: (uploadToken) => apiRequest(`/v1/consultations/${encodeURIComponent(consultationId)}/documents/finalize`, { method: 'POST', body: { uploadToken } }),
  });

/** The document as a Blob, via a short-lived signed URL issued after the API's access check and audit. */
export const downloadDocument = (id) => fetchSignedBlob(() => apiRequest(`/v1/medical-documents/${encodeURIComponent(id)}/download-url`));

export const archiveDocument = (id) => apiRequest(`/v1/medical-documents/${encodeURIComponent(id)}/archive`, { method: 'POST', body: {} });

/* ------------------------------------------------------------ admin (metadata only) */

const q = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)]));
export const adminRecordsOverview = () => apiRequest('/v1/admin/medical-records/overview');
export const adminRecordsPrescriptions = (params = {}) => apiRequest(`/v1/admin/medical-records/prescriptions?${q(params)}`);
export const adminRecordsDocuments = (params = {}) => apiRequest(`/v1/admin/medical-records/documents?${q(params)}`);
export const adminRecordsAudit = (params = {}) => apiRequest(`/v1/admin/medical-records/audit?${q(params)}`);
