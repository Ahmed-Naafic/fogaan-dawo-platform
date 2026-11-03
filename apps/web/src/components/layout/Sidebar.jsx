import { NavLink } from 'react-router-dom';
import { Headphones, X } from 'lucide-react';
import Logo from '@/components/shared/Logo';
import { useI18n } from '@/lib/i18n';
import { getAdminStats } from '@/services';
import { cn } from '@/lib/cn';

const badgeSources = {
  pendingVerification: () => getAdminStats().pendingVerification,
};

export default function Sidebar({ items, home, onNavigate, onClose, className }) {
  const { t } = useI18n();
  return (
    <aside
      className={cn(
        'flex h-full w-[248px] flex-col bg-sidebar text-sidebar-ink dark:border-r dark:border-sidebar-line',
        className,
      )}
    >
      <div className="flex items-center justify-between px-5 pb-6 pt-6">
        <Logo to={home} variant="light" stacked />
        {onClose && (
          <button onClick={onClose} className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label={t('common.close')}>
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 scrollbar-none" aria-label={t('nav.main')}>
        {items.map(({ to, label, icon: Icon, end, badge }) => {
          const count = badge ? badgeSources[badge]?.() : null;
          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13.5px] font-medium transition-colors',
                  isActive
                    ? 'bg-sidebar-active text-white shadow-[0_6px_16px_rgb(21_154_145/0.35)] dark:bg-gradient-to-r dark:from-[#127A6E] dark:to-[#1A9A8A]'
                    : 'text-sidebar-ink/85 hover:bg-white/[0.06] hover:text-white',
                )
              }
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
              <span className="flex-1 truncate">{t(label)}</span>
              {count ? <span className="rounded-full bg-red-500 px-2 py-0.5 text-2xs font-bold text-white">{count}</span> : null}
            </NavLink>
          );
        })}
      </nav>

      <div className="mx-3 mb-5 mt-4 border-t border-sidebar-line pt-4">
        <a
          href="mailto:support@fogaandawo.app"
          className="flex items-center gap-3 rounded-xl px-3 py-2 text-white transition-colors hover:bg-white/[0.06]"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20">
            <Headphones className="h-[18px] w-[18px]" />
          </span>
          <span className="leading-tight">
            <span className="block text-[13px] font-semibold">{t('nav.needHelp')}</span>
            <span className="block text-2xs text-sidebar-ink/70">{t('nav.contactSupport')}</span>
          </span>
        </a>
      </div>
    </aside>
  );
}
