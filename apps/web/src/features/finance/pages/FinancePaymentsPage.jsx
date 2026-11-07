import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { PAYMENT_TONE, PROVIDERS } from '@/features/payments/paymentUi';
import { useI18n } from '@/lib/i18n';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import FinanceFrame, { LoadState, Pager, RangeFilter } from '../components/FinanceFrame';
import PaymentDetail, { providerName } from '../components/PaymentDetail';
import { formatMoney, PAYMENT_STATUSES, REFUND_STATE_TONE, useDebounced, useFinanceRange, useLoad } from '../financeUi';
import * as api from '../services/financeApi';

const PAGE_SIZE = 20;

/** /admin/finance/payments — every payment with search, filters, date range, pagination and details. */
export default function FinancePaymentsPage() {
  const { t, locale } = useI18n();
  const [params, setParams] = useSearchParams();
  const { range, query, setRange } = useFinanceRange('30d');
  const [term, setTerm] = useState(params.get('q') ?? '');
  const q = useDebounced(term.trim());
  const status = params.get('status') ?? '';
  const provider = params.get('provider') ?? '';
  const page = Number(params.get('page') ?? 1) || 1;
  const [open, setOpen] = useState(params.get('open'));
  const setParam = (key, value) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (value) p.set(key, value);
        else p.delete(key);
        if (key !== 'page') p.delete('page');
        return p;
      },
      { replace: true },
    );
  const state = useLoad(() => api.payments({ ...query, status, provider, q, page, pageSize: PAGE_SIZE }), [query, status, provider, q, page]);
  const data = state.data;
  const fmt = (iso) => (iso ? formatDateTime(iso, browserTimeZone(), locale) : '—');

  return (
    <FinanceFrame title={t('finance.titles.payments')} subtitle={t('finance.subtitles.payments')} actions={<RangeFilter range={range} onChange={setRange} />}>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row">
        <Input icon={Search} value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('finance.searchPayments')} aria-label={t('common.search')} className="flex-1" name="q" />
        <Select value={status} onChange={(e) => setParam('status', e.target.value)} className="lg:w-48" aria-label={t('finance.status')} name="status">
          <option value="">{t('finance.allStatuses')}</option>
          {PAYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`paymentStatus.${s}`)}
            </option>
          ))}
        </Select>
        <Select value={provider} onChange={(e) => setParam('provider', e.target.value)} className="lg:w-44" aria-label={t('finance.method')} name="provider">
          <option value="">{t('finance.allMethods')}</option>
          {PROVIDERS.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <LoadState state={state} empty={data && data.items.length === 0 ? t('finance.noPayments') : null}>
        {data && (
          <>
            <Card className="overflow-hidden">
              <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_7rem_6.5rem_7rem_8rem] gap-3 border-b border-line bg-subtle/60 px-4 py-2.5 text-2xs font-bold uppercase tracking-wide text-muted lg:grid">
                <span>{t('finance.col.parties')}</span>
                <span>{t('finance.col.reference')}</span>
                <span>{t('finance.col.method')}</span>
                <span className="text-right">{t('finance.col.amount')}</span>
                <span>{t('finance.col.status')}</span>
                <span>{t('finance.col.date')}</span>
              </div>
              <ul className="divide-y divide-line">
                {data.items.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(p.id)}
                      data-payment-row={p.id}
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-subtle lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_7rem_6.5rem_7rem_8rem] lg:items-center"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {p.appointment.patient.name} → {p.appointment.doctor.name}
                        </span>
                        <span className="block truncate font-mono text-2xs text-muted">{t('finance.col.appointmentShort', { id: p.appointment.id.slice(0, 8) })}</span>
                      </span>
                      <span className="text-right font-bold lg:hidden">{formatMoney(p.amount)}</span>
                      <span className="truncate font-mono text-2xs text-muted">{p.reference ?? '—'}</span>
                      <span className="text-xs text-muted">{providerName(p.provider)}</span>
                      <span className="hidden text-right font-bold lg:block">{formatMoney(p.amount)}</span>
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={PAYMENT_TONE[p.status]}>{t(`paymentStatus.${p.status}`)}</Badge>
                        {p.refundState !== 'NONE' && <Badge tone={REFUND_STATE_TONE[p.refundState]}>{t(`finance.refundState.${p.refundState}`)}</Badge>}
                      </span>
                      <span className="text-xs text-muted">{fmt(p.paidAt ?? p.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(n) => setParam('page', String(n))} />
          </>
        )}
      </LoadState>
      {open && <PaymentDetail id={open} onClose={() => setOpen(null)} />}
    </FinanceFrame>
  );
}
