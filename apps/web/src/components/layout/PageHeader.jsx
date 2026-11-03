import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router';
import { ArrowLeft, Bell, ChevronDown, LogOut, Menu, Repeat } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import LanguageSwitcher from '@/components/shared/LanguageSwitcher';
import ThemeToggle from '@/components/shared/ThemeToggle';
import useClickOutside from '@/hooks/useClickOutside';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

function IconButton({ children, className, ...props }) {
  return (
    <button
      type="button"
      className={cn('relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink transition-colors hover:bg-subtle', className)}
      {...props}
    >
      {children}
    </button>
  );
}

function NotificationBell() {
  const { t } = useI18n();
  return (
    <IconButton aria-label={t('common.notifications')}>
      <Bell className="h-[19px] w-[19px]" />
      <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-surface" />
    </IconButton>
  );
}

const ROLE_HOMES = [
  { role: 'patient', to: '/patient' },
  { role: 'doctor', to: '/doctor' },
  { role: 'admin', to: '/admin' },
];

function ProfileMenu({ user, role }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-2.5 rounded-xl py-1 pl-1 pr-2 hover:bg-subtle">
        <Avatar src={user.avatar} name={user.name} size="sm" />
        <span className="hidden text-left leading-tight xl:block">
          <span className="block text-[13px] font-bold">{user.name}</span>
          <span className="block text-2xs text-muted">{t(`roles.${user.role}`)}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-muted xl:block" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-line bg-surface p-1.5 shadow-float">
          <p className="px-3 pb-1 pt-2 text-2xs font-bold uppercase tracking-wider text-muted">{t('common.switchView')}</p>
          {ROLE_HOMES.map((r) => (
            <button
              key={r.role}
              onClick={() => navigate(r.to)}
              className={cn('flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium hover:bg-subtle', r.role === role ? 'text-primary' : 'text-ink')}
            >
              <Repeat className="h-4 w-4" /> {t(`roles.${r.role}`)}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <Link to="/" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink hover:bg-subtle">
            <LogOut className="h-4 w-4" /> {t('common.signOut')}
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * Dashboard page header.
 * Desktop: title + subtitle left; language, theme, bell, profile right.
 * Mobile: compact row (menu or back) with title below, as in the mobile references.
 */
export default function PageHeader({ title, subtitle, wave = false, back, mobileTitle, className }) {
  const { user, role, openMenu } = useOutletContext();
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <header className={cn('pb-5 pt-4 lg:pb-6 lg:pt-7', className)}>
      {/* mobile row */}
      <div className="mb-3 flex items-center justify-between lg:hidden">
        {back ? (
          <IconButton onClick={() => navigate(back)} aria-label={t('common.back')} className="border-transparent bg-transparent -ml-2">
            <ArrowLeft className="h-5 w-5" />
          </IconButton>
        ) : (
          <IconButton onClick={openMenu} aria-label={t('common.openMenu')} className="border-transparent bg-transparent -ml-2">
            <Menu className="h-5 w-5" />
          </IconButton>
        )}
        <div className="flex items-center gap-2">
          <ThemeToggle className="h-9 w-9 border-transparent bg-transparent" />
          <LanguageSwitcher className="[&>button]:h-9 [&>button]:border-transparent [&>button]:bg-transparent [&>button]:px-2" />
          <NotificationBell />
          <ProfileMenu user={user} role={role} />
        </div>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-extrabold leading-tight sm:text-[26px]">
            <span className="lg:hidden">{mobileTitle ?? title}</span>
            <span className="hidden lg:inline">{title}</span>
            {wave && (
              <span className="ml-1.5 inline-block origin-[70%_70%] animate-[wave_2.2s_ease-in-out_1]" aria-hidden="true">
                👋
              </span>
            )}
          </h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        <div className="hidden shrink-0 items-center gap-2.5 lg:flex">
          <LanguageSwitcher />
          <ThemeToggle />
          <NotificationBell />
          <span className="mx-1 h-8 w-px bg-line" />
          <ProfileMenu user={user} role={role} />
        </div>
      </div>
    </header>
  );
}
