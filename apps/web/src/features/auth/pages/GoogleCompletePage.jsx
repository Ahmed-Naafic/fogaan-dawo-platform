import { useEffect, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { useAuth } from '../AuthProvider';
import { FullPageLoader } from '../components/RequireRole';
import { safeNext } from '../roles';

/**
 * Landing page after Google's redirect. The API has already set the HTTP-only refresh cookie; this page
 * exchanges it for a session (the normal refresh, with rotation) and continues to `next` — which is
 * re-checked against the user's roles, like every post-login destination.
 */
export default function GoogleCompletePage() {
  const auth = useAuth();
  const [params] = useSearchParams();
  const [destination, setDestination] = useState(null);
  const started = useRef(false);
  const { status, completeExternalSignIn } = auth;

  useEffect(() => {
    // Wait for the provider's own restore attempt (if any) so two refreshes never overlap.
    if (status === 'loading' || started.current) return;
    started.current = true;
    const next = params.get('next');
    if (status === 'authenticated') {
      setDestination(safeNext(next, auth.session));
      return;
    }
    completeExternalSignIn()
      .then((result) => setDestination(safeNext(next, result)))
      .catch(() => setDestination('/login?authError=GOOGLE_FAILED'));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once the session state is known
  }, [status]);

  return destination ? <Navigate to={destination} replace /> : <FullPageLoader />;
}
