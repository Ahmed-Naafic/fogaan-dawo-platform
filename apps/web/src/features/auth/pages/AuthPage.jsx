import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Eye, EyeOff, Lock, Mail, ShieldCheck, User } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import LanguageSwitcher from '@/components/shared/LanguageSwitcher';
import { LogoMark } from '@/components/shared/Logo';
import Tabs from '@/components/ui/Tabs';
import ThemeToggle from '@/components/shared/ThemeToggle';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n';
import onboarding from '@/assets/images/onboarding.jpg';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9Z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7Z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44Z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9Z" />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
      <path d="M16.37 12.62c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.77-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.42-3.69ZM14.1 5.86c.63-.77 1.06-1.83.94-2.9-.91.04-2.02.61-2.67 1.37-.58.68-1.1 1.77-.96 2.81 1.02.08 2.06-.52 2.69-1.28Z" />
    </svg>
  );
}

const ROLE_HOME = { patient: '/patient', doctor: '/doctor', admin: '/admin' };

export default function AuthPage({ mode: initialMode = 'login' }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const notify = useToast();
  const [params] = useSearchParams();
  const [mode, setMode] = useState(initialMode);
  const [showPw, setShowPw] = useState(false);
  const [role, setRole] = useState(params.get('role') === 'doctor' ? 'doctor' : 'patient');

  return (
    <div className="grid min-h-[100dvh] bg-bg lg:grid-cols-2">
      {/* Brand panel (desktop) */}
      <aside className="relative hidden overflow-hidden bg-brand-navy p-12 text-white lg:flex lg:flex-col dark:bg-[#03131D]">
        <div className="pointer-events-none absolute -bottom-40 -left-24 h-[28rem] w-[28rem] rounded-full bg-brand-teal/35 blur-3xl" aria-hidden="true" />
        <Link to="/" className="relative inline-flex items-center gap-2.5">
          <LogoMark className="h-9 w-9" />
          <span className="text-lg font-bold">Fogaan Dawo App</span>
        </Link>
        <div className="relative my-auto max-w-md">
          <img src={onboarding} alt="" className="mb-10 aspect-[204/177] w-72 rounded-3xl object-cover shadow-float" />
          <h2 className="text-4xl font-extrabold leading-tight text-white">{t('auth.panelTitle')}</h2>
          <p className="mt-4 text-base leading-relaxed text-white/70">{t('auth.panelBody')}</p>
        </div>
        <p className="relative flex items-center gap-2 text-sm text-white/60">
          <ShieldCheck className="h-4 w-4" /> {t('auth.secure')}
        </p>
      </aside>

      {/* Form */}
      <main className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link to="/" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold text-muted hover:text-ink" aria-label={t('common.back')}>
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">{t('auth.backHome')}</span>
          </Link>
          <ThemeToggle />
        </div>

        <div className="mx-auto my-auto w-full max-w-sm py-8">
          <div className="mb-8 flex flex-col items-center text-center">
            <LogoMark className="h-14 w-14" />
            <h1 className="mt-3 text-xl font-extrabold">Fogaan Dawo App</h1>
            <p className="mt-1 text-sm text-muted">{mode === 'login' ? t('auth.welcomeBack') : t('auth.createAccount')}</p>
          </div>

          <Tabs
            value={mode}
            onChange={setMode}
            className="mb-6 p-1.5"
            items={[
              { value: 'login', label: t('auth.login') },
              { value: 'register', label: t('auth.register') },
            ]}
          />

          <form
            className="space-y-3.5"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(ROLE_HOME[role]);
            }}
          >
            {mode === 'register' && <Input icon={User} placeholder={t('auth.fullName')} aria-label={t('auth.fullName')} autoComplete="name" />}
            <Input icon={Mail} placeholder={t('auth.emailOrPhone')} aria-label={t('auth.emailOrPhone')} autoComplete="username" />
            <Input
              icon={Lock}
              type={showPw ? 'text' : 'password'}
              placeholder={t('auth.password')}
              aria-label={t('auth.password')}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              trailing={
                <button type="button" onClick={() => setShowPw((v) => !v)} className="rounded-lg p-1.5 text-muted hover:text-ink" aria-label={showPw ? t('auth.hidePassword') : t('auth.showPassword')}>
                  {showPw ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              }
            />
            {mode === 'login' && (
              <div className="text-right">
                <button type="button" onClick={() => notify(t('auth.phaseNotice'))} className="text-xs font-bold text-primary hover:underline">
                  {t('auth.forgot')}
                </button>
              </div>
            )}

            <fieldset className="rounded-xl border border-dashed border-line p-3">
              <legend className="px-1.5 text-2xs font-semibold uppercase tracking-wider text-muted">{t('auth.demoAccess')}</legend>
              <div className="grid grid-cols-3 gap-1.5">
                {Object.keys(ROLE_HOME).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRole(r)}
                    aria-pressed={role === r}
                    className={`rounded-lg py-2 text-xs font-semibold transition-colors ${role === r ? 'bg-primary-soft text-primary ring-1 ring-primary/40' : 'text-muted hover:bg-subtle'}`}
                  >
                    {t(`roles.${r}`)}
                  </button>
                ))}
              </div>
            </fieldset>

            <Button type="submit" size="lg" className="w-full">
              {mode === 'login' ? t('auth.login') : t('auth.register')}
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" /> {t('auth.orContinue')} <span className="h-px flex-1 bg-line" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => notify(t('auth.phaseNotice'))} aria-label="Google">
              <GoogleIcon /> Google
            </Button>
            <Button variant="secondary" onClick={() => notify(t('auth.phaseNotice'))} aria-label="Apple">
              <AppleIcon /> Apple
            </Button>
          </div>
          <div className="mt-8 flex justify-center">
            <LanguageSwitcher align="left" />
          </div>
        </div>
      </main>
    </div>
  );
}
