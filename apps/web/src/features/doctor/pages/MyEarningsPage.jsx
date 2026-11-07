import { Link, useSearchParams } from 'react-router';
import { Banknote, Info, Percent, Undo2, Wallet } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { Select } from '@/components/ui/Input';
import StatCard from '@/components/ui/StatCard';
import { DemoBanner } from '@/features/payments/pages/CheckoutPage';
import { LoadState, Pager, RangeFilter } from '@/features/finance/components/FinanceFrame';
import { formatMoney, useFinanceRange, useLoad } from '@/features/finance/financeUi';
import { useI18n } from '@/lib/i18n';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import * as api from '../services/doctorWorkspaceApi';

const PAGE_SIZE = 20;
export const EARNING_STATUSES = Object.freeze(['PENDING', 'AVAILABLE', 'PARTIALLY_REFUNDED', 'REFUNDED']);
const STATUS_TONE = Object.freeze({ PENDING: 'gold', AVAILABLE: 'green', PARTIALLY_REFUNDED: 'blue', REFUNDED: 'purple' });

/**
 * /doctor/earnings — the doctor's CALCULATED earnings for consultations paid in the period, after refunds.
 * Payments are simulated and Fogaan Dawo has no payout system: nothing here means money was transferred.
 */
export default function MyEarningsPage() {
  const { t, locale } = useI18n();
  const tz = browserTimeZone();
  const [params, setParams] = useSearchParams();
  const { range, query, setRange } = useFinanceRange('30d');
  const status = EARNING_STATUSES.includes(params.get('status')) ? params.get('status') : '';
  const page = Number(params.get('page') ?? 1) || 1;
  const state = useLoad(() => api.myEarnings({ ...query, status, page, pageSize: PAGE_SIZE }), [query, status, page]);
  const data = state.data;

  const setStatus = (value) =>
    setParams((p) => (p.delete('page'), value ? p.set('status', value) : p.delete('status'), p), { replace: true });

  return (
    <>
      <PageHeader title={t('myEarnings.title')} subtitle={t('myEarnings.subtitle')} back="/doctor" />
      <DemoBanner className="mb-4" />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <RangeFilter range={range} onChange={setRange} />
        <label className="block">
          <span className="mb-1 block text-2xs font-semibold text-muted">{t('myEarnings.statusFilter')}</span>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-52" name="status" aria-label={t('myEarnings.statusFilter')}>
            <option value="">{t('myEarnings.allStatuses')}</option>
            {EARNING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`earningStatus.${s}`)}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <p className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200" data-no-payouts>
        <Info className="mt-0.5 h-4 w-4 shrink-0" /> {t('myEarnings.noPayouts')}
      </p>
      <LoadState state={state}>
        {data && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
              <StatCard compact icon={Banknote} tone="teal" label={t('myEarnings.gross')} value={formatMoney(data.totals.gross)} />
              <StatCard compact icon={Percent} tone="gold" label={t('myEarnings.commission')} value={formatMoney(data.totals.commissionBeforeRefunds)} />
              <StatCard compact icon={Undo2} tone="purple" label={t('myEarnings.deductions')} value={formatMoney(data.totals.doctorRefundDeductions)} />
              <StatCard compact icon={Wallet} tone="green" label={t('myEarnings.net')} value={formatMoney(data.totals.doctorNet)} />
            </div>
            <div className="mb-4 flex flex-wrap gap-2" data-status-counts>
              {EARNING_STATUSES.map((s) => (
                <Badge key={s} tone={STATUS_TONE[s]}>
                  {t(`earningStatus.${s}`)}: {data.statusCounts[s] ?? 0}
                </Badge>
              ))}
            </div>
            {data.items.length === 0 ? (
              <div className="card p-8 text-center text-sm text-muted">{t('myEarnings.empty')}</div>
            ) : (
              <Card className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm" data-my-earnings-table>
                  <thead className="border-b border-line bg-subtle/60 text-left text-2xs font-bold uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-4 py-2.5">{t('myEarnings.col.consultation')}</th>
                      <th className="px-3 py-2.5">{t('myEarnings.col.status')}</th>
                      <th className="px-3 py-2.5 text-right">{t('myEarnings.gross')}</th>
                      <th className="px-3 py-2.5 text-right">{t('myEarnings.commission')}</th>
                      <th className="px-3 py-2.5 text-right">{t('myEarnings.deductions')}</th>
                      <th className="px-4 py-2.5 text-right">{t('myEarnings.net')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.items.map((r) => (
                      <tr key={r.id} data-my-earning-row={r.id}>
                        <td className="px-4 py-3">
                          <Link to={`/doctor/appointments/${r.appointmentId}`} className="font-semibold hover:text-primary">
                            {r.patientName}
                          </Link>
                          <p className="text-2xs text-muted">{formatDateTime(r.appointmentStartAt, tz, locale)}</p>
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={STATUS_TONE[r.status]}>{t(`earningStatus.${r.status}`)}</Badge>
                        </td>
                        <td className="px-3 py-3 text-right">{formatMoney(r.gross)}</td>
                        <td className="px-3 py-3 text-right text-muted">{formatMoney(r.commission)}</td>
                        <td className="px-3 py-3 text-right text-muted">{formatMoney(r.refundDeduction)}</td>
                        <td className="px-4 py-3 text-right font-bold">{formatMoney(r.net)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
            <p className="mt-3 text-2xs text-muted">{t('myEarnings.note')}</p>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(n) => setParams((p) => (p.set('page', String(n)), p), { replace: true })} />
          </>
        )}
      </LoadState>
    </>
  );
}
