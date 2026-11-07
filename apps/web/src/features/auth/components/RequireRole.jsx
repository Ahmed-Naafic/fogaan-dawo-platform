import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ShieldAlert } from 'lucide-react';
import Button from '@/components/ui/Button';
import { LogoMark } from '@/components/shared/Logo';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '../AuthProvider';
import { ROLE_HOME } from '../roles';

/** Shown while the session is being restored or the active role is switching. */
export function FullPageLoader() {
  const { t } = useI18n();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-bg" role="status" aria-live="polite">
      <LogoMark className="h-12 w-12 animate-pulse" />
      <span className="sr-only">{t('auth.loading')}</span>
    </div>
  );
}

/** Authenticated but not allowed: same card language as the existing "coming soon" page. */
export function ForbiddenPage() {
  const { t } = useI18n();
  const { session } = useAuth();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-bg px-4">
      <div className="card flex max-w-md flex-col items-center px-6 py-14 text-center" role="alert">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <ShieldAlert className="h-8 w-8" />
        </span>
        <h1 className="mt-5 text-lg font-bold">{t('authz.forbiddenTitle')}</h1>
        <p className="mt-2 max-w-sm text-sm text-muted">{t('authz.forbiddenBody')}</p>
        <Button to={ROLE_HOME[session?.activeRole] ?? '/'} className="mt-6">
          {t('authz.goHome')}
        </Button>
      </div>
    </div>
  );
}

function SwitchThenRender({ role, children }) {
  const { switchRole } = useAuth();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    switchRole(role).catch(() => setFailed(true));
  }, [role, switchRole]);
  return failed ? <ForbiddenPage /> : <FullPageLoader />;
}

/**
 * Route guard (UX only — the API enforces every permission on its own).
 * - not signed in            → /login?next=<this path>
 * - active role allowed      → render
 * - allowed role assigned    → switch the session to it via the API, then render
 * - no allowed role assigned → forbidden page
 */
export default function RequireRole({ roles, children }) {
  const { status, session } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullPageLoader />;
  if (status !== 'authenticated') {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  if (roles.includes(session.activeRole)) return children;
  const assigned = roles.find((r) => session.roles.includes(r));
  if (assigned) return <SwitchThenRender role={assigned}>{children}</SwitchThenRender>;
  return <ForbiddenPage />;
}
