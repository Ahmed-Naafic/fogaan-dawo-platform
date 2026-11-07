import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { BadgeCheck, CircleHelp, ShieldAlert, ShieldCheck } from 'lucide-react';
import PublicHeader from '@/components/layout/PublicHeader';
import Card from '@/components/ui/Card';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { verifyPrescription } from '../services/prescriptionApi';

/**
 * /verify/:token — public page the prescription QR code opens (pharmacists, patients). Shows only whether
 * the prescription is genuine and valid, its status, issue date and the issuing doctor. Never the patient,
 * medicines or any clinical detail (the API never returns them).
 */
export default function VerifyPrescriptionPage() {
  const { token } = useParams();
  const { t, lang, locale } = useI18n();
  const [result, setResult] = useState(undefined);

  useEffect(() => {
    let live = true;
    verifyPrescription(token)
      .then((r) => live && setResult(r))
      .catch((e) => live && setResult(e?.code === 'RATE_LIMITED' ? { error: 'RATE_LIMITED' } : e?.status === 400 ? { valid: false } : { error: 'GENERIC' }));
    return () => {
      live = false;
    };
  }, [token]);

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString(locale, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  let tone = 'neutral';
  let Icon = CircleHelp;
  let title = '';
  let body = '';
  if (result?.error) {
    title = t('verify.errorTitle');
    body = t(result.error === 'RATE_LIMITED' ? 'verify.rateLimited' : 'verify.errorBody');
  } else if (result && !result.status) {
    tone = 'bad';
    Icon = ShieldAlert;
    title = t('verify.notFoundTitle');
    body = t('verify.notFoundBody');
  } else if (result) {
    tone = result.valid ? 'good' : 'bad';
    Icon = result.valid ? ShieldCheck : ShieldAlert;
    title = t(`verify.status.${result.status}`);
    body = t(`verify.statusBody.${result.status}`);
  }

  return (
    <div className="min-h-screen bg-bg">
      <PublicHeader />
      <main className="mx-auto max-w-xl px-4 pb-16 pt-8 sm:px-6">
        <h1 className="mb-1 text-2xl font-extrabold">{t('verify.title')}</h1>
        <p className="mb-6 text-sm text-muted">{t('verify.subtitle')}</p>
        {result === undefined ? (
          <div className="card h-48 animate-pulse" aria-busy="true" />
        ) : (
          <Card className="p-6" data-verify-result={result?.status ?? (result?.error ? 'error' : 'unknown')} role="status">
            <div className="flex items-start gap-4">
              <span className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', tone === 'good' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300' : tone === 'bad' ? 'bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-300' : 'bg-subtle text-muted')}>
                <Icon className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-extrabold">{title}</h2>
                <p className="mt-1 text-sm text-muted">{body}</p>
              </div>
            </div>
            {result?.status && (
              <dl className="mt-5 divide-y divide-line border-t border-line text-sm">
                <div className="flex justify-between gap-3 py-2.5">
                  <dt className="text-muted">{t('verify.issued')}</dt>
                  <dd className="text-right font-semibold">{fmt(result.issuedAt)}</dd>
                </div>
                {result.cancelledAt && (
                  <div className="flex justify-between gap-3 py-2.5">
                    <dt className="text-muted">{t('verify.cancelled')}</dt>
                    <dd className="text-right font-semibold">{fmt(result.cancelledAt)}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3 py-2.5">
                  <dt className="text-muted">{t('verify.doctor')}</dt>
                  <dd className="text-right font-semibold">
                    <span className="inline-flex items-center gap-1">
                      {result.issuedBy.name} <BadgeCheck className="h-4 w-4 fill-primary text-surface" aria-hidden="true" />
                    </span>
                    <span className="block text-xs font-normal text-muted">{lang === 'so' ? result.issuedBy.specialty?.nameSo : result.issuedBy.specialty?.nameEn}</span>
                  </dd>
                </div>
              </dl>
            )}
            <p className="mt-5 text-2xs text-muted">{t('verify.privacy')}</p>
          </Card>
        )}
      </main>
    </div>
  );
}
