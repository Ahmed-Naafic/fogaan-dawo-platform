import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router';
import { AlertCircle, ArrowLeft, Eye, EyeOff, Lock, Mail, ShieldCheck, User } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import LanguageSwitcher from '@/components/shared/LanguageSwitcher';
import { LogoMark } from '@/components/shared/Logo';
import Tabs from '@/components/ui/Tabs';
import ThemeToggle from '@/components/shared/ThemeToggle';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n';
import onboarding from '@/assets/images/onboarding.jpg';
import { useAuth } from '../AuthProvider';
import GoogleIcon from '../components/GoogleIcon';
import { googleErrorKey, googleNextParam } from '../googleAuth';
import * as authApi from '../services/authApi';
import { errorMessageKey, fieldsForError, validateAuthForm } from '../authForm';
import { roleLabelKey, safeNext } from '../roles';

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
      <path d="M16.37 12.62c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.77-2.23.87-1.28 1.23-2.52 1.25-2.58-.03-.01-2.4-.92-2.42-3.69ZM14.1 5.86c.63-.77 1.06-1.83.94-2.9-.91.04-2.02.61-2.67 1.37-.58.68-1.1 1.77-.96 2.81 1.02.08 2.06-.52 2.69-1.28Z" />
    </svg>
  );
}

// Public account types. ADMIN is never offered: admins are granted by an administrator only.
// Both choices create the same base account (the API never accepts a role at registration). Choosing
// DOCTOR then continues to the doctor application; the DOCTOR role is granted only when an
// administrator approves it.
const REGISTER_ACCOUNT_TYPES = ['PATIENT', 'DOCTOR'];
const EMPTY_FORM = { fullName: '', identifier: '', password: '', passwordConfirmation: '' };
const INVALID_FIELD = 'border-danger/70 focus:border-danger focus:ring-danger/10';

export default function AuthPage({ mode: initialMode = 'login' }) {
  const { t, lang } = useI18n();
  const notify = useToast();
  const auth = useAuth();
  const [params] = useSearchParams();
  const [mode, setMode] = useState(initialMode);
  const [showPw, setShowPw] = useState(false);
  const [values, setValues] = useState(EMPTY_FORM);
  const [invalid, setInvalid] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const next = params.get('next');
  const [accountType, setAccountType] = useState(params.get('role') === 'doctor' ? 'DOCTOR' : 'PATIENT');
  const doctorSelected = mode === 'register' && accountType === 'DOCTOR';
  const [destination, setDestination] = useState(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  // Outcome code from Google's redirect (only a code travels in the URL, never a token).
  const [googleError, setGoogleError] = useState(() => params.get('authError'));

  // Tell the user once if they were sent here because their session ended.
  useEffect(() => {
    if (auth.endedReason && next) notify(t('authErrors.SESSION_EXPIRED'), 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on arrival
  }, []);

  // One redirect only: where this sign-in should lead (set on success), otherwise the user's dashboard
  // for an already signed-in visitor. A separate navigate() call would race with this redirect.
  if (destination) return <Navigate to={destination} replace />;
  if (auth.status === 'authenticated' && !submitting) {
    return <Navigate to={safeNext(next, auth.session)} replace />;
  }

  const field = (name) => ({
    value: values[name],
    onChange: (e) => {
      setValues((v) => ({ ...v, [name]: e.target.value }));
      if (invalid[name]) setInvalid((s) => ({ ...s, [name]: false }));
    },
    'aria-invalid': invalid[name] || undefined,
    inputClassName: invalid[name] ? INVALID_FIELD : undefined,
  });

  const switchMode = (m) => {
    setMode(m);
    setInvalid({});
  };

  async function onSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    const { errors, payload } = validateAuthForm(mode, values, { language: lang });
    if (payload === null) {
      setInvalid(Object.fromEntries(Object.keys(errors).map((k) => [k, true])));
      notify(t(Object.values(errors)[0]), 'error');
      return;
    }
    setSubmitting(true);
    try {
      const result = mode === 'login' ? await auth.login(payload) : await auth.register(payload);
      // Registering as a doctor continues to the doctor application (the account starts as a patient).
      setDestination(mode === 'register' && accountType === 'DOCTOR' ? '/patient/doctor-application?welcome=1' : safeNext(next, result));
    } catch (error) {
      setInvalid(Object.fromEntries(fieldsForError(error).map((k) => [k, true])));
      notify(t(errorMessageKey(error)), 'error');
      setSubmitting(false);
    }
  }

  async function continueWithGoogle() {
    if (googleBusy) return;
    setGoogleBusy(true);
    setGoogleError(null);
    try {
      // Registering as a doctor continues to the doctor application, exactly like the form does.
      const after = doctorSelected ? '/patient/doctor-application?welcome=1' : googleNextParam(next);
      const { authorizationUrl } = await authApi.startGoogleSignIn({ next: after, language: lang });
      window.location.assign(authorizationUrl);
    } catch (error) {
      setGoogleError(error.code);
      setGoogleBusy(false);
    }
  }

  const passwordToggle = (
    <button type="button" onClick={() => setShowPw((v) => !v)} className="rounded-lg p-1.5 text-muted hover:text-ink" aria-label={showPw ? t('auth.hidePassword') : t('auth.showPassword')}>
      {showPw ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
    </button>
  );

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

          {googleError && (
            <div role="alert" data-google-error={googleError} className="mb-5 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/5 px-3.5 py-3 text-xs leading-relaxed text-danger">
              <AlertCircle className="mt-px h-4 w-4 shrink-0" />
              <span>{t(googleErrorKey(googleError))}</span>
            </div>
          )}

          <Tabs
            value={mode}
            onChange={switchMode}
            className="mb-6 p-1.5"
            items={[
              { value: 'login', label: t('auth.login') },
              { value: 'register', label: t('auth.register') },
            ]}
          />

          <form className="space-y-3.5" onSubmit={onSubmit} noValidate aria-busy={submitting || undefined}>
            {mode === 'register' && (
              <Input icon={User} name="fullName" placeholder={t('auth.fullName')} aria-label={t('auth.fullName')} autoComplete="name" {...field('fullName')} />
            )}
            <Input icon={Mail} name="identifier" placeholder={t('auth.emailOrPhone')} aria-label={t('auth.emailOrPhone')} autoComplete="username" {...field('identifier')} />
            <Input
              icon={Lock}
              name="password"
              type={showPw ? 'text' : 'password'}
              placeholder={t('auth.password')}
              aria-label={t('auth.password')}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              trailing={passwordToggle}
              {...field('password')}
            />
            {mode === 'register' && (
              <Input
                icon={Lock}
                name="passwordConfirmation"
                type={showPw ? 'text' : 'password'}
                placeholder={t('auth.confirmPassword')}
                aria-label={t('auth.confirmPassword')}
                autoComplete="new-password"
                {...field('passwordConfirmation')}
              />
            )}
            {mode === 'login' && (
              <div className="text-right">
                <button type="button" onClick={() => notify(t('auth.phaseNotice'))} className="text-xs font-bold text-primary hover:underline">
                  {t('auth.forgot')}
                </button>
              </div>
            )}

            {mode === 'register' && (
              <fieldset className="rounded-xl border border-dashed border-line p-3">
                <legend className="px-1.5 text-2xs font-semibold uppercase tracking-wider text-muted">{t('auth.accountType')}</legend>
                <div className="grid grid-cols-2 gap-1.5">
                  {REGISTER_ACCOUNT_TYPES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setAccountType(r)}
                      aria-pressed={accountType === r}
                      className={`rounded-lg py-2 text-xs font-semibold transition-colors ${accountType === r ? 'bg-primary-soft text-primary ring-1 ring-primary/40' : 'text-muted hover:bg-subtle'}`}
                    >
                      {t(roleLabelKey(r))}
                    </button>
                  ))}
                </div>
                {doctorSelected && (
                  <p id="doctor-signup-note" role="note" className="mt-2.5 px-1 text-xs leading-relaxed text-muted">
                    {t('auth.doctorSignupNote')}
                  </p>
                )}
              </fieldset>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={submitting}
              aria-describedby={doctorSelected ? 'doctor-signup-note' : undefined}
            >
              {submitting ? t('auth.pleaseWait') : mode === 'login' ? t('auth.login') : t('auth.register')}
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" /> {t('auth.orContinue')} <span className="h-px flex-1 bg-line" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={continueWithGoogle} disabled={googleBusy} aria-label={t('googleAuth.continue')} aria-busy={googleBusy || undefined}>
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
