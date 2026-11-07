import { apiRequest } from '@/lib/apiClient';

/** Video consultation API (all checks — ownership, payment, join window, roles — happen on the server). */
export const joinConsultation = (appointmentId) => apiRequest(`/v1/consultations/${appointmentId}/join`, { method: 'POST', body: {} });
export const newSignalingTicket = (consultationId) => apiRequest(`/v1/consultations/${consultationId}/ticket`, { method: 'POST', body: {} });
export const getConsultationState = (consultationId) => apiRequest(`/v1/consultations/${consultationId}`);
export const admitPatient = (consultationId) => apiRequest(`/v1/consultations/${consultationId}/admit`, { method: 'POST', body: {} });
export const rejectPatient = (consultationId) => apiRequest(`/v1/consultations/${consultationId}/reject`, { method: 'POST', body: {} });
export const leaveConsultation = (consultationId) => apiRequest(`/v1/consultations/${consultationId}/leave`, { method: 'POST', body: {} });
export const endConsultation = (consultationId) => apiRequest(`/v1/consultations/${consultationId}/end`, { method: 'POST', body: {} });
export const saveConsultationNote = (consultationId, note) => apiRequest(`/v1/consultations/${consultationId}/note`, { method: 'PUT', body: note });
