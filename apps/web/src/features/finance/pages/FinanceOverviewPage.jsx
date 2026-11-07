import { Link } from 'react-router';
import { AlertTriangle, Banknote, CheckCircle2, Clock3, Landmark, Percent, Undo2, Wallet, XCircle } from 'lucide-react';
import Card, { CardHeader } from '@/components/ui/Card';
import StatCard from '@/components/ui/StatCard';
import { PROVIDERS } from '@/features/payments/paymentUi';
import { useI18n } from '@/lib/i18n';
import FinanceFrame, { LoadState, RangeFilter } from '../components/FinanceFrame';
import { formatMoney, formatRate, useFinanceRange, useLoad } from '../financeUi';
import * as api from '../services/financeApi';

/** /admin/finance — totals for the selected period, from stored (simulated) records. */
export default function FinanceOverviewPage() {
  const { t } = useI18n();
  const { range, query, setRange } = useFinanceRange('30d');
  const state = useLoad(() => api.overview(query), [query]);
  const o = state.data;
  return (
    <FinanceFrame title={t('finance.titles.overview')} subtitle={t('finance.subtitles.overview')} actions={<RangeFilter range={range} onChange={setRange} />}>
      <LoadState state={state} height="h-72">
        {o && (
          <div className="space-y-5" data-overview>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard icon={Banknote} tone="teal" label={t('finance.cards.gross')} value={formatMoney(o.grossVolume.amount)} />
              <StatCard icon={Undo2} tone="purple" label={t('finance.cards.refunds')} value={formatMoney(o.refunds.amount)} />
              <StatCard icon={Percent} tone="gold" label={t('finance.cards.platform')} value={formatMoney(o.platformEarnings.amount)} />
              <StatCard icon={Wallet} tone="green" label={t('finance.cards.doctors')} value={formatMoney(o.doctorEarnings.amount)} />
            </div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <StatCard compact icon={CheckCircle2} tone="green" label={t('finance.cards.successful')} value={o.successfulPayments} />
              <StatCard compact icon={Clock3} tone="gold" label={t('finance.cards.pending')} value={o.pendingPayments} />
              <StatCard compact icon={XCircle} tone="rose" label={t('finance.cards.failed')} value={o.failedPayments} />
              <StatCard compact icon={Landmark} tone="blue" label={t('finance.cards.net')} value={formatMoney(o.netAfterRefunds)} />
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <Card className="p-5 sm:p-6">
                <CardHeader title={t('finance.byProvider')} />
                <ul className="divide-y divide-line">
                  {PROVIDERS.map((p) => {
                    const row = o.byProvider.find((x) => x.provider === p.code);
                    return (
                      <li key={p.code} className="flex items-center justify-between py-2.5 text-sm">
                        <span className="font-semibold">{p.name}</span>
                        <span className="text-muted">
                          {t('finance.paymentsCount', { count: row?.count ?? 0 })} · <span className="font-bold text-ink">{formatMoney(row?.amount ?? '0.00')}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
              <Card className="space-y-3 p-5 text-sm sm:p-6">
                <CardHeader title={t('finance.queue.title')} />
                <Link to="/admin/finance/refunds?status=REQUESTED&preset=all" className="flex items-center justify-between rounded-xl bg-subtle px-4 py-3 hover:bg-primary-soft" data-open-refunds>
                  <span className="font-semibold">{t('finance.queue.open', { count: o.openRefunds.count })}</span>
                  <span className="font-bold">{formatMoney(o.openRefunds.amount)}</span>
                </Link>
                {o.failedRefunds.count > 0 && (
                  <Link to="/admin/finance/refunds?status=FAILED&preset=all" className="flex items-center justify-between rounded-xl bg-red-50 px-4 py-3 text-danger hover:bg-red-100 dark:bg-red-500/10">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <AlertTriangle className="h-4 w-4" /> {t('finance.queue.failed', { count: o.failedRefunds.count })}
                    </span>
                    <span className="font-bold">{formatMoney(o.failedRefunds.amount)}</span>
                  </Link>
                )}
                <Link to="/admin/finance/settings" className="flex items-center justify-between rounded-xl bg-subtle px-4 py-3 hover:bg-primary-soft">
                  <span className="font-semibold">{t('finance.queue.rate')}</span>
                  <span className="font-bold">{formatRate(o.commissionRate)}</span>
                </Link>
              </Card>
            </div>
            <Card className="p-5 text-xs leading-relaxed text-muted sm:p-6">
              <p className="mb-1 font-bold text-ink">{t('finance.definitions.title')}</p>
              <p>{t('finance.definitions.gross')}</p>
              <p>{t('finance.definitions.refunds')}</p>
              <p>{t('finance.definitions.split')}</p>
              <p>{t('finance.definitions.counts')}</p>
            </Card>
          </div>
        )}
      </LoadState>
    </FinanceFrame>
  );
}
