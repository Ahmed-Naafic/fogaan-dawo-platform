import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { navigation } from '@/app/navigation';
import { useAuth } from '@/features/auth/AuthProvider';
import { listApplications, VERIFICATION_CHANGED } from '@/features/admin/services/verificationApi';
import { NotificationsProvider } from '@/features/notifications/NotificationsProvider';
import useOwnPhoto from '@/features/profile/useOwnPhoto';
import Sidebar from './Sidebar';
import MobileTabBar from './MobileTabBar';

/** Display data for the signed-in user (real name; own private photo, else Avatar shows initials). */
function displayUser(session, avatar) {
  const fullName = session.user.fullName;
  const firstName = fullName.replace(/^Dr\.?\s+/i, '').split(/\s+/)[0] || fullName;
  return { name: fullName, firstName, role: session.activeRole.toLowerCase(), avatar };
}

/**
 * Role-aware application frame (rendered only behind RequireRole, so a session exists).
 * Desktop (lg+): fixed navy sidebar. Mobile: bottom tab bar + slide-in drawer.
 * Pages render their own <PageHeader/> and receive { role, user, openMenu } via outlet context.
 */
export default function AppShell({ role }) {
  const nav = navigation[role];
  const { session } = useAuth();
  const photo = useOwnPhoto();
  const user = displayUser(session, photo);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Admin sidebar badge: real number of applications awaiting verification — refreshed on navigation
  // and immediately after every approve / reject / start-review decision.
  const [badges, setBadges] = useState({});
  useEffect(() => {
    if (role !== 'admin') return undefined;
    let cancelled = false;
    const load = () =>
      listApplications('pending')
        .then((d) => !cancelled && setBadges({ pendingVerification: d.counts.pending }))
        .catch(() => {});
    load();
    window.addEventListener(VERIFICATION_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(VERIFICATION_CHANGED, load);
    };
  }, [role, pathname]);
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  return (
    <NotificationsProvider>
    <div className="min-h-screen bg-bg">
      <Sidebar items={nav.sidebar} home={nav.home} badges={badges} className="fixed inset-y-0 left-0 z-30 hidden lg:flex" />

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <Sidebar items={nav.sidebar} home={nav.home} badges={badges} onClose={() => setDrawerOpen(false)} className="relative shadow-float" />
        </div>
      )}

      <main className="pb-24 lg:pb-8 lg:pl-[248px]">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
          <Outlet context={{ role, user, openMenu: () => setDrawerOpen(true) }} />
        </div>
      </main>

      <MobileTabBar items={nav.tabs} onMore={() => setDrawerOpen(true)} />
    </div>
    </NotificationsProvider>
  );
}
