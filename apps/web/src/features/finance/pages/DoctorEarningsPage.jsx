import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Banknote, Info, Percent, Search, Undo2, Wallet } from 'lucide-react';
import Card from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import StatCard from '@/components/ui/StatCard';
import { useI18n } from '@/lib/i18n';
import FinanceFrame, { LoadState, Pager, RangeFilter } from '../components/FinanceFrame';
import { formatMoney, useDebounced, useFinanceRange, useLoad } from '../financeUi';
import * as api from '../services/financeApi';

const PAGE_SIZE = 20;

/**
 * /admin/finance/doctor-earnings — CALCULATED earnings per doctor for consultations paid in the period,
 * after refunds. Fogaan Dawo has no payout system: nothing here means money was transferred.
 */
export default function DoctorEarningsPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const { range, query, setRange } = useFinanceRange('30d');
  const [term, setTerm] = useState('');
  const q = useDebounced(term.trim());
  const page = Number(params.get('page') ?? 1) || 1;
  const state = useLoad(() => api.doctorEarnings({ ...query, q, page, pageSize: PAGE_SIZE }), [query, q, page]);
  const data = state.data;
  return (
    <FinanceFrame title={t('finance.titles.earnings')} subtitle={t('finance.subtitles.earnings')} actions={<RangeFilter range={range} onChange={setRange} />}>
      <p className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200" data-no-payouts>
        <Info className="mt-0.5 h-4 w-4 shrink-0" /> {t('finance.earnings.noPayouts')}
      </p>
      <Input icon={Search} value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('finance.earnings.search')} aria-label={t('common.search')} className="mb-4" name="doctorQ" />
      <LoadState state={state} empty={data && data.items.length === 0 ? t('finance.earnings.empty') : null}>
        {data && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
              <StatCard compact icon={Banknote} tone="teal" label={t('finance.earnings.gross')} value={formatMoney(data.totals.gross)} />
              <StatCard compact icon={Undo2} tone="purple" label={t('finance.earnings.refunds')} value={formatMoney(data.totals.refunds)} />
              <StatCard compact icon={Percent} tone="gold" label={t('finance.earnings.commission')} value={formatMoney(data.totals.commission)} />
              <StatCard compact icon={Wallet} tone="green" label={t('finance.earnings.net')} value={formatMoney(data.totals.doctorNet)} />
            </div>
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm" data-earnings-table>
                <thead className="border-b border-line bg-subtle/60 text-left text-2xs font-bold uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2.5">{t('finance.col.doctor')}</th>
                    <th className="px-3 py-2.5 text-right">{t('finance.earnings.paid')}</th>
                    <th className="px-3 py-2.5 text-right">{t('finance.earnings.completed')}</th>
                    <th className="px-3 py-2.5 text-right">{t('finance.earnings.gross')}</th>
                    <th className="px-3 py-2.5 text-right">{t('finance.earnings.deductions')}</th>
                    <th className="px-3 py-2.5 text-right">{t('finance.earnings.commission')}</th>
                    <th className="px-3 py-2.5 text-right">{t('finance.earnings.net')}</th>
                    <th className="px-4 py-2.5">{t('finance.earnings.settlement')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.items.map((r) => (
                    <tr key={r.doctor.id} data-earning-row={r.doctor.id}>
                      <td className="px-4 py-3 font-semibold">{r.doctor.name}</td>
                      <td className="px-3 py-3 text-right">{r.paidConsultations}</td>
                      <td className="px-3 py-3 text-right">{r.completedConsultations}</td>
                      <td className="px-3 py-3 text-right">{formatMoney(r.gross)}</td>
                      <td className="px-3 py-3 text-right text-muted">{formatMoney(r.refundDeductions)}</td>
                      <td className="px-3 py-3 text-right text-muted">{formatMoney(r.platformCommission)}</td>
                      <td className="px-3 py-3 text-right font-bold">{formatMoney(r.netEarnings)}</td>
                      <td className="px-4 py-3 text-xs text-muted">{t('finance.earnings.pendingSettlement')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <p className="mt-3 text-2xs text-muted">{t('finance.earnings.note')}</p>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(n) => setParams((p) => (p.set('page', String(n)), p), { replace: true })} />
          </>
        )}
      </LoadState>
    </FinanceFrame>
  );
}
