import { apiRequest } from '@/lib/apiClient';

/** Patient bookings (API: PATIENT role; the patient is always the signed-in user). */
export const bookSlot = (slotId, reason) => apiRequest('/v1/appointments', { method: 'POST', body: { slotId, ...(reason ? { reason } : {}) } });
export const listMyAppointments = (scope = 'upcoming') => apiRequest(`/v1/appointments?scope=${encodeURIComponent(scope)}`);
export const getMyAppointment = (id) => apiRequest(`/v1/appointments/${encodeURIComponent(id)}`);
export const cancelMyAppointment = (id, reason) => apiRequest(`/v1/appointments/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: reason ? { reason } : {} });
export const ensureConsultationRecord = (id) => apiRequest(`/v1/appointments/${encodeURIComponent(id)}/consultation-record`, { method: 'POST', body: {} });
export const proposeFollowUp = (consultationId, body) => apiRequest(`/v1/consultations/${encodeURIComponent(consultationId)}/follow-up`, { method: 'POST', body });
export const confirmFreeFollowUp = (id) => apiRequest(`/v1/appointments/${encodeURIComponent(id)}/confirm-free`, { method: 'POST', body: {} });
export const rateAppointment = (id, body) => apiRequest(`/v1/appointments/${encodeURIComponent(id)}/review`, { method: 'POST', body });
export const requestNoShowRefund = (id) => apiRequest(`/v1/appointments/${encodeURIComponent(id)}/no-show-refund`, { method: 'POST', body: {} });
export const rescheduleMyAppointment = (id, slotId) => apiRequest(`/v1/appointments/${encodeURIComponent(id)}/reschedule`, { method: 'POST', body: { slotId } });

/** The doctor's own appointments (API: DOCTOR role). */
export const listDoctorAppointments = (scope = 'upcoming') => apiRequest(`/v1/doctors/me/appointments?scope=${encodeURIComponent(scope)}`);
export const getDoctorAppointment = (id) => apiRequest(`/v1/doctors/me/appointments/${encodeURIComponent(id)}`);
export const cancelDoctorAppointment = (id, reason) => apiRequest(`/v1/doctors/me/appointments/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { reason } });
