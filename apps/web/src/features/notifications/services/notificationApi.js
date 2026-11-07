import { apiRequest } from '@/lib/apiClient';
import { browserTimeZone } from '@/lib/timezone';

/** /api/v1/notifications — text comes back rendered in the requested language and the browser's time zone. */
const reader = (lang) => `lang=${encodeURIComponent(lang)}&tz=${encodeURIComponent(browserTimeZone())}`;

export const listNotifications = ({ lang, unread = false, cursor = null, limit = 20 }) =>
  apiRequest(`/v1/notifications?${reader(lang)}&limit=${limit}${unread ? '&unread=true' : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);

export const unreadCount = () => apiRequest('/v1/notifications/unread-count');
export const setRead = (id, read) => apiRequest(`/v1/notifications/${id}`, { method: 'PATCH', body: { read } });
export const readAll = () => apiRequest('/v1/notifications/read-all', { method: 'POST' });
export const deleteNotification = (id) => apiRequest(`/v1/notifications/${id}`, { method: 'DELETE' });

export const getPreferences = () => apiRequest('/v1/notifications/preferences');
export const updatePreferences = (changes) => apiRequest('/v1/notifications/preferences', { method: 'PUT', body: changes });
export const registerPushSubscription = (subscription) => apiRequest('/v1/notifications/push-subscriptions', { method: 'POST', body: subscription });
export const removePushSubscription = (endpoint) => apiRequest('/v1/notifications/push-subscriptions', { method: 'DELETE', body: { endpoint } });

export const streamPath = (lang) => `/v1/notifications/stream?${reader(lang)}`;
