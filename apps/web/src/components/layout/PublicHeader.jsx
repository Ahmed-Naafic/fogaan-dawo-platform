import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { Link } from 'react-router';
import Logo from '@/components/shared/Logo';
import Button from '@/components/ui/Button';
import LanguageSwitcher from '@/components/shared/LanguageSwitcher';
import ThemeToggle from '@/components/shared/ThemeToggle';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

const LINKS = [
  { href: '/#home', label: 'landing.nav.home' },
  { href: '/doctors', label: 'landing.nav.doctors' },
  { href: '/#specialties', label: 'landing.nav.specialties' },
  { href: '/#how-it-works', label: 'landing.nav.howItWorks' },
  { href: '/#about', label: 'landing.nav.about' },
];

/** Section anchors on the landing page use <a>; real pages use client-side navigation. */
function NavLink({ href, ...props }) {
  return href.includes('#') ? <a href={href} {...props} /> : <Link to={href} {...props} />;
}

export default function PublicHeader() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 transition-all',
        scrolled ? 'border-b border-line bg-surface/85 backdrop-blur-xl' : 'border-b border-transparent bg-transparent',
      )}
    >
      <div className="mx-auto flex h-[72px] max-w-site items-center gap-6 px-4 sm:px-6">
        <Logo />
        <nav className="ml-auto hidden items-center gap-7 lg:flex" aria-label={t('nav.main')}>
          {LINKS.map((l) => (
            <NavLink key={l.href} href={l.href} className="text-[13.5px] font-semibold text-ink/80 transition-colors hover:text-primary">
              {t(l.label)}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2.5 lg:ml-6">
          <LanguageSwitcher />
          <ThemeToggle className="hidden sm:inline-flex" />
          <Button to="/login" variant="secondary" size="sm" className="hidden h-10 px-5 sm:inline-flex">
            {t('landing.nav.login')}
          </Button>
          <Button to="/register" size="sm" className="hidden h-10 px-5 sm:inline-flex">
            {t('landing.nav.getStarted')}
          </Button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={t('common.openMenu')}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface lg:hidden"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-line bg-surface px-4 pb-5 pt-2 shadow-float lg:hidden">
          <nav className="flex flex-col" aria-label={t('nav.main')}>
            {LINKS.map((l) => (
              <NavLink key={l.href} href={l.href} onClick={() => setOpen(false)} className="border-b border-line py-3.5 text-[15px] font-semibold">
                {t(l.label)}
              </NavLink>
            ))}
          </nav>
          <div className="mt-4 flex items-center gap-2.5">
            <ThemeToggle />
            <Button to="/login" variant="secondary" className="flex-1">
              {t('landing.nav.login')}
            </Button>
            <Button to="/register" className="flex-1">
              {t('landing.nav.getStarted')}
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
