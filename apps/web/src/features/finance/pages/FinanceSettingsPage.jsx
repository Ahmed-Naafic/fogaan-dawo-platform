import { useState } from 'react';
import { Percent, ShieldCheck } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { Dialog } from '@/features/appointments/components/AppointmentDialogs';
import { useI18n } from '@/lib/i18n';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import FinanceFrame, { LoadState } from '../components/FinanceFrame';
import { financeErrorKey, useLoad } from '../financeUi';
import * as api from '../services/financeApi';

const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;
const pct = (v) => (v == null ? '—' : `${Number(v)}%`);

/** /admin/finance/settings — the platform commission (applies to new bookings only), with confirmation and history. */
export default function FinanceSettingsPage() {
  const { t, locale } = useI18n();
  const notify = useToast();
  const state = useLoad(() => api.settings(), []);
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = state.data;
  const fmt = (iso) => (iso ? formatDateTime(iso, browserTimeZone(), locale) : '—');

  const review = (e) => {
    e.preventDefault();
    const v = value.trim();
    if (!PERCENT.test(v) || Number(v) > 100) return setError('finance.settings.invalid');
    if (s?.commission.percent != null && Number(v) === Number(s.commission.percent)) return setError('financeErrors.COMMISSION_UNCHANGED');
    setError(null);
    return setConfirming(true);
  };
  const save = async () => {
    setBusy(true);
    try {
      await api.updateCommission(value.trim());
      notify(t('finance.settings.saved', { rate: pct(value.trim()) }), 'success');
      setConfirming(false);
      setValue('');
      state.reload();
    } catch (err) {
      notify(t(financeErrorKey(err)), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FinanceFrame title={t('finance.titles.settings')} subtitle={t('finance.subtitles.settings')}>
      <LoadState state={state} height="h-64">
        {s && (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <Card className="p-5 sm:p-6" data-commission-settings>
              <CardHeader title={t('finance.settings.commissionTitle')} subtitle={t('finance.settings.commissionSubtitle')} />
              <div className="flex items-center gap-4 rounded-2xl bg-primary-soft p-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-fg">
                  <Percent className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-2xs font-semibold uppercase tracking-wide text-muted">{t('finance.settings.current')}</p>
                  <p className="text-2xl font-extrabold" data-current-rate>
                    {pct(s.commission.percent)}
                  </p>
                  {s.commission.updatedAt && <p className="text-2xs text-muted">{t('finance.settings.updated', { by: s.commission.updatedBy ?? '—', at: fmt(s.commission.updatedAt) })}</p>}
                </div>
              </div>
              <form className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={review} noValidate>
                <label className="block flex-1">
                  <span className="mb-1.5 block text-xs font-semibold text-muted">{t('finance.settings.newRate')}</span>
                  <Input value={value} onChange={(e) => (setValue(e.target.value), setError(null))} inputMode="decimal" placeholder="15" name="commissionPercent" aria-invalid={Boolean(error)} trailing={<span className="text-sm text-muted">%</span>} />
                </label>
                <Button type="submit" disabled={!value.trim()} data-review-commission>
                  {t('finance.settings.review')}
                </Button>
              </form>
              {error && (
                <p className="mt-2 text-xs text-danger" role="alert">
                  {t(error)}
                </p>
              )}
              <p className="mt-4 flex items-start gap-2 text-xs text-muted">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {t('finance.settings.historyProtected')}
              </p>
            </Card>
            <Card className="p-5 sm:p-6">
              <CardHeader title={t('finance.settings.history')} />
              {s.history.length === 0 ? (
                <p className="text-sm text-muted">{t('finance.settings.noHistory')}</p>
              ) : (
                <ol className="space-y-3 border-l-2 border-line pl-4 text-xs" data-commission-history>
                  {s.history.map((h, i) => (
                    <li key={i}>
                      <span className="font-semibold">
                        {pct(h.fromPercent)} → {pct(h.toPercent)}
                      </span>
                      <span className="block text-muted">
                        {h.by} · {fmt(h.at)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
        )}
      </LoadState>
      {confirming && (
        <Dialog title={t('finance.settings.confirmTitle')} onClose={() => setConfirming(false)} busy={busy} labelledBy="commission-confirm-title">
          <p className="text-sm">{t('finance.settings.confirmBody', { from: pct(s.commission.percent), to: pct(value.trim()) })}</p>
          <p className="mt-2 text-xs text-muted">{t('finance.settings.historyProtected')}</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button onClick={save} disabled={busy} data-confirm-commission>
              {t('finance.settings.confirm')}
            </Button>
          </div>
        </Dialog>
      )}
    </FinanceFrame>
  );
}
