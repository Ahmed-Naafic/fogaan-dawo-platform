import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { navigation } from '@/app/navigation';
import { getCurrentUser } from '@/services';
import Sidebar from './Sidebar';
import MobileTabBar from './MobileTabBar';

/**
 * Role-aware application frame.
 * Desktop (lg+): fixed navy sidebar. Mobile: bottom tab bar + slide-in drawer.
 * Pages render their own <PageHeader/> and receive { role, user, openMenu } via outlet context.
 */
export default function AppShell({ role }) {
  const nav = navigation[role];
  const user = getCurrentUser(role);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);
  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  return (
    <div className="min-h-screen bg-bg">
      <Sidebar items={nav.sidebar} home={nav.home} className="fixed inset-y-0 left-0 z-30 hidden lg:flex" />

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <Sidebar items={nav.sidebar} home={nav.home} onClose={() => setDrawerOpen(false)} className="relative shadow-float" />
        </div>
      )}

      <main className="pb-24 lg:pb-8 lg:pl-[248px]">
        <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8">
          <Outlet context={{ role, user, openMenu: () => setDrawerOpen(true) }} />
        </div>
      </main>

      <MobileTabBar items={nav.tabs} onMore={() => setDrawerOpen(true)} />
    </div>
  );
}
