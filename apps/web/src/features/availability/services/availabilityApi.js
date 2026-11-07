import { apiRequest } from '@/lib/apiClient';

/** The signed-in doctor's own availability (no doctor id is ever sent — the API uses the session). */

const BASE = '/v1/doctors/me/availability';

export const getMyAvailability = () => apiRequest(BASE);

export const getMyCalendar = ({ from, days = 7, tz }) => apiRequest(`${BASE}/calendar?${new URLSearchParams({ ...(from ? { from } : {}), days: String(days), ...(tz ? { tz } : {}) })}`);

export const saveSchedule = (body) => apiRequest(`${BASE}/schedule`, { method: 'PUT', body });

export const deleteRule = (ruleId) => apiRequest(`${BASE}/rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' });

export const addBlock = (body) => apiRequest(`${BASE}/blocks`, { method: 'POST', body });

export const removeBlock = (blockId) => apiRequest(`${BASE}/blocks/${encodeURIComponent(blockId)}`, { method: 'DELETE' });
