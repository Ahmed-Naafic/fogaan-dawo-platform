import { useState } from 'react';
import { Download } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { REFUND_TONE, saveBlob } from '@/features/payments/paymentUi';
import { useI18n } from '@/lib/i18n';
import FinanceFrame, { LoadState, RangeFilter } from '../components/FinanceFrame';
import { providerName } from '../components/PaymentDetail';
import { financeErrorKey, formatMoney, formatRate, useFinanceRange, useLoad } from '../financeUi';
import * as api from '../services/financeApi';

const EXPORTS = ['summary', 'payments', 'refunds', 'doctor-earnings'];

function Metric({ label, value, strong }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className={strong ? 'font-extrabold' : 'font-semibold'}>{value}</span>
    </div>
  );
}

/** Horizontal bars per period (gross volume), with refunds and commission in the table below. */
function Trend({ rows, label }) {
  const { t } = useI18n();
  const max = Math.max(1, ...rows.map((r) => Number(r.gross)));
  if (!rows.length) return <p className="py-6 text-center text-sm text-muted">{t('finance.reports.noActivity')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-xs" aria-label={label}>
        <thead className="border-b border-line text-left text-2xs font-bold uppercase tracking-wide text-muted">
          <tr>
            <th className="py-2 pr-3">{t('finance.reports.period')}</th>
            <th className="py-2 pr-3">{t('finance.reports.gross')}</th>
            <th className="py-2 pr-3 text-right">{t('finance.reports.refunds')}</th>
            <th className="py-2 pr-3 text-right">{t('finance.reports.commission')}</th>
            <th className="py-2 text-right">{t('finance.reports.doctors')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.period}>
              <td className="whitespace-nowrap py-2 pr-3 font-mono">{r.period}</td>
              <td className="py-2 pr-3">
                <span className="flex items-center gap-2">
                  <span className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(2, (Number(r.gross) / max) * 120)}px` }} aria-hidden="true" />
                  <span className="font-semibold">{formatMoney(r.gross)}</span>
                  <span className="text-muted">({r.payments})</span>
                </span>
              </td>
              <td className="py-2 pr-3 text-right">{formatMoney(r.refunds)}</td>
              <td className="py-2 pr-3 text-right">{formatMoney(r.commission)}</td>
              <td className="py-2 text-right">{formatMoney(r.doctorEarnings)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** /admin/finance/reports — summaries, method breakdown, refunds, commission, doctors, trends and CSV export. */
export default function FinanceReportsPage() {
  const { t } = useI18n();
  const notify = useToast();
  const { range, query, setRange } = useFinanceRange('30d');
  const state = useLoad(() => api.report(query), [query]);
  const [downloading, setDownloading] = useState(null);
  const r = state.data;

  const download = async (type) => {
    setDownloading(type);
    try {
      const blob = await api.exportCsv({ ...query, type });
      saveBlob(blob, `fogaan-dawo-${type}_${r?.range.fromDate ?? 'all-time'}_${r?.range.toDate ?? ''}.csv`.replace(/_\.csv$/, '.csv'));
      notify(t('finance.reports.exported'), 'success');
    } catch (error) {
      notify(t(financeErrorKey(error)), 'error');
    } finally {
      setDownloading(null);
    }
  };

  return (
    <FinanceFrame
      title={t('finance.titles.reports')}
      subtitle={t('finance.subtitles.reports')}
      actions={
        <>
          <RangeFilter range={range} onChange={setRange} />
          <div className="flex flex-wrap gap-2" data-exports>
            {EXPORTS.map((type) => (
              <Button key={type} size="sm" variant="secondary" disabled={!r || downloading === type} onClick={() => download(type)} data-export={type}>
                <Download className="h-3.5 w-3.5" /> {t(`finance.reports.export.${type}`)}
              </Button>
            ))}
          </div>
        </>
      }
    >
      <LoadState state={state} height="h-96">
        {r && (
          <div className="space-y-5" data-report>
            <div className="grid gap-5 lg:grid-cols-3">
              <Card className="p-5 sm:p-6">
                <CardHeader title={t('finance.reports.revenue')} />
                <div className="divide-y divide-line">
                  <Metric label={t('finance.cards.gross')} value={formatMoney(r.revenue.grossVolume)} />
                  <Metric label={t('finance.reports.paymentsCount')} value={r.revenue.payments} />
                  <Metric label={t('finance.cards.refunds')} value={`− ${formatMoney(r.revenue.refunds)}`} />
                  <Metric label={t('finance.cards.net')} value={formatMoney(r.revenue.netAfterRefunds)} strong />
                </div>
              </Card>
              <Card className="p-5 sm:p-6">
                <CardHeader title={t('finance.reports.commissionTitle')} />
                <div className="divide-y divide-line">
                  <Metric label={t('finance.reports.beforeRefunds')} value={formatMoney(r.commission.beforeRefunds)} />
                  <Metric label={t('finance.reports.reversed')} value={`− ${formatMoney(r.commission.reversedByRefunds)}`} />
                  <Metric label={t('finance.cards.platform')} value={formatMoney(r.commission.net)} strong />
                </div>
                {r.commission.byRate.length > 0 && (
                  <ul className="mt-3 space-y-1 text-2xs text-muted" data-by-rate>
                    {r.commission.byRate.map((x) => (
                      <li key={x.rate}>{t('finance.reports.atRate', { rate: formatRate(x.rate), count: x.consultations, commission: formatMoney(x.commission) })}</li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card className="p-5 sm:p-6">
                <CardHeader title={t('finance.reports.doctorTitle')} />
                <div className="divide-y divide-line">
                  <Metric label={t('finance.reports.beforeRefunds')} value={formatMoney(r.doctorEarnings.beforeRefunds)} />
                  <Metric label={t('finance.reports.reversed')} value={`− ${formatMoney(r.doctorEarnings.reversedByRefunds)}`} />
                  <Metric label={t('finance.cards.doctors')} value={formatMoney(r.doctorEarnings.net)} strong />
                </div>
                <p className="mt-3 text-2xs text-muted">{t('finance.earnings.noPayouts')}</p>
              </Card>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card className="p-5 sm:p-6">
                <CardHeader title={t('finance.reports.byMethod')} />
                {r.byMethod.length === 0 ? (
                  <p className="text-sm text-muted">{t('finance.reports.noActivity')}</p>
                ) : (
                  <ul className="divide-y divide-line text-sm" data-by-method>
                    {r.byMethod.map((m) => (
                      <li key={m.provider} className="flex items-center justify-between gap-3 py-2.5">
                        <span className="font-semibold">{providerName(m.provider)}</span>
                        <span className="text-right text-xs text-muted">
                          {t('finance.paymentsCount', { count: m.payments })} · <span className="font-bold text-ink">{formatMoney(m.gross)}</span>
                          <span className="block">{t('finance.reports.refundedVia', { amount: formatMoney(m.refunds), count: m.refundCount })}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card className="p-5 sm:p-6">
                <CardHeader title={t('finance.reports.refundSummary')} />
                <Metric label={t('finance.reports.paidOut')} value={`${formatMoney(r.refundSummary.paidOut.amount)} (${r.refundSummary.paidOut.count})`} strong />
                <ul className="mt-2 flex flex-wrap gap-2">
                  {r.refundSummary.byStatus.map((s) => (
                    <li key={s.status}>
                      <Badge tone={REFUND_TONE[s.status]}>
                        {t(`refundStatus.${s.status}`)} · {s.count} · {formatMoney(s.amount)}
                      </Badge>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-2xs text-muted">{t('finance.reports.refundNote')}</p>
              </Card>
            </div>

            <Card className="p-5 sm:p-6">
              <CardHeader title={t('finance.reports.topDoctors')} />
              {r.doctorEarnings.topDoctors.length === 0 ? (
                <p className="text-sm text-muted">{t('finance.reports.noActivity')}</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {r.doctorEarnings.topDoctors.map((d) => (
                    <li key={d.doctor.id} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0 truncate font-semibold">{d.doctor.name}</span>
                      <span className="shrink-0 text-xs text-muted">
                        {t('finance.paymentsCount', { count: d.paidConsultations })} · <span className="font-bold text-ink">{formatMoney(d.netEarnings)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {r.trends.daily && (
              <Card className="p-5 sm:p-6" data-trend="daily">
                <CardHeader title={t('finance.reports.daily')} />
                <Trend rows={r.trends.daily} label={t('finance.reports.daily')} />
              </Card>
            )}
            <Card className="p-5 sm:p-6" data-trend="monthly">
              <CardHeader title={t('finance.reports.monthly')} />
              <Trend rows={r.trends.monthly} label={t('finance.reports.monthly')} />
            </Card>
          </div>
        )}
      </LoadState>
    </FinanceFrame>
  );
}
