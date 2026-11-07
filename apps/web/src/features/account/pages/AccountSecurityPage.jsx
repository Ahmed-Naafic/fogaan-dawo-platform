import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AlertCircle, CheckCircle2, KeyRound, Link2, Unlink, X } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n';
import GoogleIcon from '@/features/auth/components/GoogleIcon';
import { googleErrorKey } from '@/features/auth/googleAuth';
import * as authApi from '@/features/auth/services/authApi';
import ChangePasswordCard from '@/features/profile/components/ChangePasswordCard';

function MethodRow({ icon, title, status, body, action, testId }) {
  return (
    <div data-method={testId} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface">{icon}</span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink">
            {title} {status}
          </p>
          <div className="mt-0.5 text-xs leading-relaxed text-muted">{body}</div>
        </div>
      </div>
      {action && <div className="flex shrink-0 sm:justify-end">{action}</div>}
    </div>
  );
}

function ConfirmDisconnect({ busy, onCancel, onConfirm }) {
  const { t } = useI18n();
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && !busy && onCancel();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [busy, onCancel]);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="disconnect-google-title">
      <button aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onCancel()} />
      <div className="relative w-full max-w-md animate-fade-up rounded-t-3xl border border-line bg-surface p-5 shadow-float sm:rounded-3xl sm:p-6">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 id="disconnect-google-title" className="text-lg font-extrabold">
            {t('accountSecurity.google.confirmTitle')}
          </h2>
          <button type="button" onClick={onCancel} disabled={busy} className="-mr-2 -mt-1 rounded-lg p-2 text-muted hover:bg-subtle" aria-label={t('common.close')}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="text-sm leading-relaxed text-muted">{t('accountSecurity.google.confirmBody')}</p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            <Unlink className="h-4 w-4" /> {t('accountSecurity.google.disconnect')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Account security: which sign-in methods the account has, and connecting / disconnecting Google. */
export default function AccountSecurityPage() {
  const { t, lang, locale } = useI18n();
  const notify = useToast();
  const [params, setParams] = useSearchParams();
  const [methods, setMethods] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Outcome of a Google connect redirect (a code only).
  const [linkError, setLinkError] = useState(() => params.get('googleError'));
  const arrived = useRef(false);

  const load = useCallback(() => {
    authApi
      .signInMethods()
      .then((m) => {
        setMethods(m);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true));
  }, []);

  useEffect(() => {
    load();
    if (arrived.current) return; // StrictMode runs effects twice in development: announce once
    arrived.current = true;
    if (params.get('google') === 'connected') notify(t('accountSecurity.google.connectedToast'));
    if (params.has('google') || params.has('googleError')) setParams({}, { replace: true }); // no repeat on reload
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on arrival only
  }, []);

  const connect = async () => {
    setBusy(true);
    setLinkError(null);
    try {
      const { authorizationUrl } = await authApi.startGoogleLink({ language: lang });
      window.location.assign(authorizationUrl);
    } catch (error) {
      setLinkError(error.code);
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      setMethods(await authApi.disconnectGoogle());
      setConfirming(false);
      notify(t('accountSecurity.google.disconnectedToast'));
    } catch (error) {
      notify(t(googleErrorKey(error.code)), 'error');
      setConfirming(false);
      load();
    } finally {
      setBusy(false);
    }
  };

  const date = (iso) => (iso ? new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : null);
  const google = methods?.google;

  let googleBody;
  let googleAction = null;
  if (google) {
    if (google.connected) {
      googleBody = (
        <>
          <span className="block font-semibold text-ink">{google.email}</span>
          <span className="block">
            {t('accountSecurity.google.connectedOn', { date: date(google.connectedAt) })}
            {google.lastUsedAt && ` · ${t('accountSecurity.google.lastUsed', { date: date(google.lastUsedAt) })}`}
          </span>
          {!google.canDisconnect && <span className="mt-1 block">{t('accountSecurity.google.onlyMethod')}</span>}
        </>
      );
      if (google.canDisconnect) {
        googleAction = (
          <Button variant="secondary" size="sm" className="text-danger" onClick={() => setConfirming(true)} disabled={busy}>
            <Unlink className="h-4 w-4" /> {t('accountSecurity.google.disconnect')}
          </Button>
        );
      }
    } else if (!google.allowed) {
      googleBody = t('accountSecurity.google.adminOnly');
    } else if (!google.available) {
      googleBody = t('googleAuth.errors.GOOGLE_UNAVAILABLE');
    } else {
      googleBody = t('accountSecurity.google.connectBody');
      googleAction = (
        <Button variant="outline" size="sm" onClick={connect} disabled={busy} aria-busy={busy || undefined}>
          <Link2 className="h-4 w-4" /> {t('accountSecurity.google.connect')}
        </Button>
      );
    }
  }

  return (
    <>
      <PageHeader title={t('accountSecurity.title')} subtitle={t('accountSecurity.subtitle')} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-5">
        <Card className="p-5 sm:p-6">
          <CardHeader title={t('accountSecurity.methodsTitle')} subtitle={t('accountSecurity.methodsHint')} />

          {linkError && (
            <div role="alert" data-google-error={linkError} className="mb-4 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/5 px-3.5 py-3 text-xs leading-relaxed text-danger">
              <AlertCircle className="mt-px h-4 w-4 shrink-0" />
              <span>{t(googleErrorKey(linkError))}</span>
            </div>
          )}

          {loadFailed && (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-subtle px-4 py-3 text-sm text-muted">
              {t('accountSecurity.loadFailed')}
              <Button variant="secondary" size="sm" onClick={load}>
                {t('accountSecurity.retry')}
              </Button>
            </div>
          )}

          {!methods && !loadFailed && (
            <div className="space-y-3" aria-busy="true">
              <div className="h-14 animate-pulse rounded-xl bg-subtle" />
              <div className="h-14 animate-pulse rounded-xl bg-subtle" />
            </div>
          )}

          {methods && (
            <div className="divide-y divide-line">
              <MethodRow
                testId="password"
                icon={<KeyRound className="h-5 w-5 text-primary" />}
                title={t('accountSecurity.password.title')}
                status={
                  methods.password.enabled ? (
                    <Badge tone="green" icon={CheckCircle2}>
                      {t('accountSecurity.on')}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">{t('accountSecurity.password.notSet')}</Badge>
                  )
                }
                body={t(methods.password.enabled ? 'accountSecurity.password.onBody' : 'accountSecurity.password.offBody')}
              />
              <MethodRow
                testId="google"
                icon={<GoogleIcon />}
                title="Google"
                status={
                  google.connected ? (
                    <Badge tone="green" icon={CheckCircle2}>
                      {t('accountSecurity.google.connected')}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">{t('accountSecurity.google.notConnected')}</Badge>
                  )
                }
                body={googleBody}
                action={googleAction}
              />
            </div>
          )}
        </Card>
        {methods && <ChangePasswordCard hasPassword={methods.password.enabled} />}
        </div>

        <Card className="p-5 sm:p-6">
          <CardHeader title={t('accountSecurity.aboutTitle')} />
          <ul className="space-y-2.5 text-xs leading-relaxed text-muted">
            <li>{t('accountSecurity.about.sub')}</li>
            <li>{t('accountSecurity.about.noAutoLink')}</li>
            <li>{t('accountSecurity.about.roles')}</li>
            <li>{t('accountSecurity.about.keepOne')}</li>
            <li>{t('accountSecurity.about.passwordChange')}</li>
          </ul>
        </Card>
      </div>

      {confirming && <ConfirmDisconnect busy={busy} onCancel={() => setConfirming(false)} onConfirm={disconnect} />}
    </>
  );
}
