import { apiRequest } from '@/lib/apiClient';

/** Patient–doctor messages (PATIENT or DOCTOR role). The API checks participation on every call. */
const enc = encodeURIComponent;

/** Fired (window event) when a message arrives or is read, from the notification stream. */
export const MESSAGES_CHANGED = 'fd:messages-changed';

export const listConversations = () => apiRequest('/v1/messages/conversations');
export const getConversation = (appointmentId, before) => apiRequest(`/v1/messages/conversations/${enc(appointmentId)}${before ? `?before=${enc(before)}` : ''}`);
export const sendMessage = (appointmentId, body) => apiRequest(`/v1/messages/conversations/${enc(appointmentId)}/messages`, { method: 'POST', body: { body } });
export const markRead = (appointmentId) => apiRequest(`/v1/messages/conversations/${enc(appointmentId)}/read`, { method: 'POST', body: {} });
export const unreadCount = () => apiRequest('/v1/messages/unread-count');

const CODES = new Set(['CONVERSATION_NOT_FOUND', 'CONVERSATION_CLOSED', 'MESSAGING_PROFILE_REQUIRED', 'VALIDATION_ERROR', 'RATE_LIMITED', 'NETWORK_ERROR']);
export const messagingErrorKey = (error) => `messages.errors.${CODES.has(error?.code) ? error.code : 'GENERIC'}`;
