import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { onSessionEnded } from '@/lib/apiClient';
import * as authApi from './services/authApi';
import { disablePushOnThisDevice } from '@/features/notifications/push';

/**
 * Authentication state for the web app.
 *
 * Persistence: the session itself survives reloads through the HTTP-only refresh cookie (never readable
 * by JavaScript). The only thing stored in localStorage is a boolean hint ("a session probably exists")
 * so anonymous visitors don't trigger a pointless refresh call on every page load. No token is stored.
 */
const AuthContext = createContext(null);
const SESSION_HINT_KEY = 'fd-has-session';

const setHint = (on) => {
  try {
    if (on) localStorage.setItem(SESSION_HINT_KEY, '1');
    else localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    /* storage unavailable (private mode): restore will simply be attempted every load */
  }
};
const hasHint = () => {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    return true;
  }
};

const toSession = (result) => ({
  user: result.user,
  roles: result.roles,
  activeRole: result.activeRole,
  profiles: result.profiles,
});

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', session: null, endedReason: null });
  const activeRoleRef = useRef(null);
  activeRoleRef.current = state.session?.activeRole ?? null;
  const switchQueue = useRef(Promise.resolve());
  const switchInFlight = useRef(null);

  const signedIn = useCallback((result) => {
    setHint(true);
    activeRoleRef.current = result.activeRole; // visible to queued switches before React re-renders
    setState({ status: 'authenticated', session: toSession(result), endedReason: null });
    return result;
  }, []);

  const signedOut = useCallback((endedReason = null) => {
    setHint(false);
    setState({ status: 'anonymous', session: null, endedReason });
  }, []);

  // Restore on load; StrictMode's double effect shares the same single-flight refresh.
  useEffect(() => {
    let cancelled = false;
    if (!hasHint()) {
      signedOut();
      return undefined;
    }
    authApi
      .restore()
      .then((result) => !cancelled && signedIn(result))
      .catch(() => !cancelled && signedOut());
    return () => {
      cancelled = true;
    };
  }, [signedIn, signedOut]);

  // Any API call that finds the session unusable (revoked, expired, suspended) signs the user out.
  useEffect(() => onSessionEnded((error) => signedOut(error?.code ?? 'SESSION_EXPIRED')), [signedOut]);

  // Every switch rotates the refresh cookie, so switches must never overlap: overlapping responses can
  // arrive out of order, leave an outdated cookie behind, and the next refresh is then (correctly)
  // treated as token reuse and the session is revoked. So switch requests are queued one at a time,
  // a request for the role already in flight is shared, and a queued switch that is no longer needed
  // (that role is already active) is skipped.
  const switchRole = useCallback(
    (role) => {
      if (switchInFlight.current?.role === role) return switchInFlight.current.promise;
      const promise = switchQueue.current
        .catch(() => {})
        .then(() => (activeRoleRef.current === role ? null : authApi.switchRole(role).then(signedIn)))
        .finally(() => {
          if (switchInFlight.current?.promise === promise) switchInFlight.current = null;
        });
      switchQueue.current = promise;
      switchInFlight.current = { role, promise };
      return promise;
    },
    [signedIn],
  );

  const value = useMemo(
    () => ({
      ...state,
      login: async (credentials) => signedIn(await authApi.login(credentials)),
      register: async (data) => signedIn(await authApi.register(data)),
      /** After Google's redirect: the API has already set the refresh cookie; exchange it for a session. */
      completeExternalSignIn: async () => signedIn(await authApi.restore()),
      switchRole,
      /**
       * Re-reads roles and profiles from the server (e.g. right after a doctor application is approved).
       * Queued with role switches: both rotate the refresh cookie and must never overlap.
       */
      reload: () => {
        const promise = switchQueue.current
          .catch(() => {})
          .then(() => authApi.restore())
          .then(signedIn);
        switchQueue.current = promise;
        return promise;
      },
      logout: async () => {
        await disablePushOnThisDevice().catch(() => {});
        try {
          await authApi.logout();
        } finally {
          signedOut();
        }
      },
      logoutAll: async () => {
        await disablePushOnThisDevice().catch(() => {});
        try {
          await authApi.logoutAll();
        } finally {
          signedOut();
        }
      },
    }),
    [state, signedIn, signedOut, switchRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
