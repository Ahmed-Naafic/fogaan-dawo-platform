import { useEffect, useState } from 'react';
import { CalendarClock, CreditCard, History, Percent, RotateCcw, Undo2 } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { LoadState } from '@/features/finance/components/FinanceFrame';
import { useLoad } from '@/features/finance/financeUi';
import { useI18n } from '@/lib/i18n';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import { adminConsoleErrorKey } from '../services/adminConsoleApi';
import * as api from '../services/adminConsoleApi';

/** The booking rules, grouped as shown on the page. `unit` picks the label suffix. */
export const POLICY_GROUPS = Object.freeze([
  { key: 'payments', icon: CreditCard, fields: [{ name: 'paymentHoldMinutes', unit: 'minutes' }, { name: 'followUpDeadlineHours', unit: 'hours' }] },
  { key: 'reschedule', icon: CalendarClock, fields: [{ name: 'maxFreeReschedules', unit: 'times' }, { name: 'freeRescheduleMinHours', unit: 'hours' }] },
  { key: 'refunds', icon: Undo2, fields: [{ name: 'fullRefundMinHours', unit: 'hours' }, { name: 'partialRefundMinHours', unit: 'hours' }] },
]);
const FIELDS = POLICY_GROUPS.flatMap((g) => g.fields.map((f) => f.name));

/** Client-side check mirroring the API: whole numbers in range, partial cut-off before the full one. */
export function policyErrors(form, limits) {
  const errors = {};
  for (const name of FIELDS) {
    const v = Number(form[name]);
    const { min, max } = limits[name];
    if (form[name] === '' || !Number.isInteger(v) || v < min || v > max) errors[name] = { key: 'adminSettings.errors.range', params: { min, max } };
  }
  if (!errors.fullRefundMinHours && !errors.partialRefundMinHours && Number(form.partialRefundMinHours) >= Number(form.fullRefundMinHours)) {
    errors.partialRefundMinHours = { key: 'adminSettings.errors.order' };
  }
  return errors;
}

/** Admin › Settings — booking rules applied to new bookings, cancellations and reschedules. */
export default function AdminSettingsPage() {
  const { t, locale } = useI18n();
  const tz = browserTimeZone();
  const notify = useToast();
  const state = useLoad(() => api.getSettings(), []);
  const policy = state.data?.bookingPolicy;
  const [form, setForm] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (policy) setForm(Object.fromEntries(FIELDS.map((n) => [n, String(policy.values[n])])));
  }, [policy]);

  const errors = form && policy ? policyErrors(form, policy.limits) : {};
  const changed = form && policy ? FIELDS.filter((n) => Number(form[n]) !== policy.values[n]) : [];
  const valid = Object.keys(errors).length === 0;

  const save = async () => {
    setBusy(true);
    try {
      await api.updateBookingPolicy(Object.fromEntries(FIELDS.map((n) => [n, Number(form[n])])));
      notify(t('adminSettings.saved'), 'success');
      setConfirming(false);
      state.reload();
    } catch (error) {
      notify(t(adminConsoleErrorKey(error)), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={t('adminSettings.title')} subtitle={t('adminSettings.subtitle')} back="/admin" />
      <LoadState state={state}>
        {policy && form && (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (valid && changed.length) setConfirming(true);
              }}
              noValidate
              className="flex flex-col gap-4"
              data-booking-policy
            >
              {POLICY_GROUPS.map(({ key, icon: Icon, fields }) => (
                <Card key={key} className="p-5">
                  <h3 className="mb-1 flex items-center gap-2 text-base font-bold">
                    <Icon className="h-4 w-4 text-primary" /> {t(`adminSettings.groups.${key}.title`)}
                  </h3>
                  <p className="mb-4 text-xs text-muted">{t(`adminSettings.groups.${key}.body`)}</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {fields.map(({ name, unit }) => (
                      <div key={name}>
                        <span className="mb-1.5 block text-xs font-semibold text-ink">{t(`adminSettings.fields.${name}`)}</span>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={policy.limits[name].min}
                          max={policy.limits[name].max}
                          step={1}
                          name={name}
                          aria-label={t(`adminSettings.fields.${name}`)}
                          inputClassName="pr-24"
                          value={form[name]}
                          disabled={busy}
                          onChange={(e) => {
                            setConfirming(false);
                            setForm((f) => ({ ...f, [name]: e.target.value }));
                          }}
                          trailing={<span className="pr-3 text-xs text-muted">{t(`adminSettings.units.${unit}`)}</span>}
                          aria-invalid={Boolean(errors[name])}
                        />
                        {errors[name] ? (
                          <span className="mt-1 block text-2xs font-medium text-danger">{t(errors[name].key, errors[name].params)}</span>
                        ) : (
                          <span className="mt-1 block text-2xs text-muted">{t('adminSettings.default', { value: policy.defaults[name] })}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </Card>
              ))}

              <Card className="p-5">
                {confirming ? (
                  <div className="flex flex-col gap-3" role="alert">
                    <p className="text-sm font-semibold">{t('adminSettings.confirmTitle', { count: changed.length })}</p>
                    <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
                      {changed.map((n) => (
                        <li key={n}>{t('adminSettings.change', { field: t(`adminSettings.fields.${n}`), from: policy.values[n], to: form[n] })}</li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted">{t('adminSettings.confirmBody')}</p>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
                        {t('common.cancel')}
                      </Button>
                      <Button onClick={save} disabled={busy} data-confirm-save>
                        {busy ? t('auth.pleaseWait') : t('adminSettings.confirmSave')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-muted">
                      {policy.updatedAt ? t('adminSettings.lastChanged', { by: policy.updatedBy ?? '—', when: formatDateTime(policy.updatedAt, tz, locale) }) : t('adminSettings.usingDefaults')}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        disabled={busy || FIELDS.every((n) => Number(form[n]) === policy.defaults[n])}
                        onClick={() => setForm(Object.fromEntries(FIELDS.map((n) => [n, String(policy.defaults[n])])))}
                      >
                        <RotateCcw className="h-4 w-4" /> {t('adminSettings.resetDefaults')}
                      </Button>
                      <Button type="submit" disabled={busy || !valid || changed.length === 0}>
                        {t('adminSettings.save')}
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            </form>

            <div className="flex flex-col gap-4">
              <Card className="p-5">
                <h3 className="mb-1 flex items-center gap-2 text-base font-bold">
                  <Percent className="h-4 w-4 text-primary" /> {t('adminSettings.commissionTitle')}
                </h3>
                <p className="text-2xl font-extrabold">{state.data.commission.percent != null ? `${Number(state.data.commission.percent)}%` : '—'}</p>
                <p className="mb-3 text-xs text-muted">{t('adminSettings.commissionBody')}</p>
                <Button variant="secondary" size="sm" to={state.data.commission.managedIn}>
                  {t('adminSettings.commissionLink')}
                </Button>
              </Card>
              <Card className="p-5">
                <h3 className="mb-3 flex items-center gap-2 text-base font-bold">
                  <History className="h-4 w-4 text-primary" /> {t('adminSettings.historyTitle')}
                </h3>
                {policy.history.length === 0 ? (
                  <p className="text-sm text-muted">{t('adminSettings.noHistory')}</p>
                ) : (
                  <ol className="space-y-3">
                    {policy.history.map((h, i) => (
                      <li key={i} className="text-xs">
                        <p className="font-semibold">
                          {h.by ?? '—'} · <span className="font-normal text-muted">{formatDateTime(h.at, tz, locale)}</span>
                        </p>
                        <ul className="mt-0.5 text-muted">
                          {Object.keys(h.after ?? {}).map((k) => (
                            <li key={k}>{t('adminSettings.change', { field: t(`adminSettings.fields.${k}`), from: h.before?.[k] ?? '—', to: h.after[k] })}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </div>
          </div>
        )}
      </LoadState>
    </>
  );
}
