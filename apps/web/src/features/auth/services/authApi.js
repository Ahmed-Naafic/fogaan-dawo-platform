import { apiRequest, refreshSession, setAccessToken } from '@/lib/apiClient';

/** Calls to /api/v1/auth. Successful sign-in responses put the access token in memory. */

const signedIn = (result) => {
  setAccessToken(result.accessToken);
  return result;
};

export const login = (credentials) => apiRequest('/v1/auth/login', { method: 'POST', body: credentials, auth: false }).then(signedIn);

export const register = (data) => apiRequest('/v1/auth/register', { method: 'POST', body: data, auth: false }).then(signedIn);

/** Restores a session from the HTTP-only refresh cookie (e.g. after a page reload). */
export const restore = () => refreshSession();

export const switchRole = (role) => apiRequest('/v1/auth/switch-role', { method: 'POST', body: { role } }).then(signedIn);

export const me = () => apiRequest('/v1/auth/me');

/* Google sign-in: the API returns Google's URL; the browser only navigates (no Google tokens here). */
export const startGoogleSignIn = ({ next, language }) => apiRequest('/v1/auth/google/start', { method: 'POST', body: { next, language }, auth: false });
export const startGoogleLink = ({ language }) => apiRequest('/v1/auth/google/link', { method: 'POST', body: { language } });
export const signInMethods = () => apiRequest('/v1/auth/methods');
export const disconnectGoogle = () => apiRequest('/v1/auth/google', { method: 'DELETE' });

/** Ends this session. The cookie is cleared by the server even if the access token has expired. */
export async function logout() {
  try {
    await apiRequest('/v1/auth/logout', { method: 'POST', body: {}, auth: false });
  } finally {
    setAccessToken(null);
  }
}

export async function logoutAll() {
  try {
    return await apiRequest('/v1/auth/logout-all', { method: 'POST' });
  } finally {
    setAccessToken(null);
  }
}
