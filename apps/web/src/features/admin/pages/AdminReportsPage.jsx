import { useState } from 'react';
import { Link } from 'react-router';
import { CalendarCheck, CalendarX2, CheckCircle2, Download, Stethoscope, UserPlus, Users, UserX } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import StatCard from '@/components/ui/StatCard';
import { useToast } from '@/components/ui/Toast';
import { AreaChart } from '@/components/ui/charts';
import { LoadState, RangeFilter } from '@/features/finance/components/FinanceFrame';
import { useFinanceRange, useLoad } from '@/features/finance/financeUi';
import { saveBlob } from '@/features/payments/paymentUi';
import { useI18n } from '@/lib/i18n';
import { adminConsoleErrorKey } from '../services/adminConsoleApi';
import * as api from '../services/adminConsoleApi';

const pct = (v) => (v == null ? '—' : `${Math.round(v * 1000) / 10}%`);

/** Axis ticks for a count series: 0 and four even steps up to a round maximum. */
export function countTicks(max) {
  const step = Math.max(1, Math.ceil(Math.max(1, max) / 4));
  return [0, step, step * 2, step * 3, step * 4];
}

/** Short axis label for a "YYYY-MM-DD" day or "YYYY-MM" month. */
function periodLabel(period, locale) {
  const date = new Date(period.length === 7 ? `${period}-01T00:00:00Z` : `${period}T00:00:00Z`);
  return date.toLocaleDateString(locale, period.length === 7 ? { timeZone: 'UTC', month: 'short', year: '2-digit' } : { timeZone: 'UTC', month: 'short', day: 'numeric' });
}

/** Admin › Reports — platform activity: sign-ups, appointments, completion and no-shows, top specialties/doctors. */
export default function AdminReportsPage() {
  const { t, lang, locale } = useI18n();
  const notify = useToast();
  const { range, query, setRange } = useFinanceRange('30d');
  const state = useLoad(() => api.reportOverview(query), [query]);
  const [downloading, setDownloading] = useState(false);
  const r = state.data;

  const download = async () => {
    setDownloading(true);
    try {
      saveBlob(await api.reportExport(query), `fogaan-dawo-activity_${r?.range.fromDate ?? 'all-time'}${r?.range.toDate ? `_${r.range.toDate}` : ''}.csv`);
      notify(t('adminReports.exported'), 'success');
    } catch (error) {
      notify(t(adminConsoleErrorKey(error)), 'error');
    } finally {
      setDownloading(false);
    }
  };

  const trend = r?.trend.map((p) => ({ label: periodLabel(p.period, locale), value: p.appointments })) ?? [];
  const max = Math.max(0, ...trend.map((p) => p.value));

  return (
    <>
      <PageHeader title={t('adminReports.title')} subtitle={t('adminReports.subtitle')} back="/admin" />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <RangeFilter range={range} onChange={setRange} />
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" to="/admin/finance/reports">
            {t('adminReports.financeLink')}
          </Button>
          <Button size="sm" onClick={download} disabled={!r || downloading} data-export="activity">
            <Download className="h-3.5 w-3.5" /> {t('adminReports.export')}
          </Button>
        </div>
      </div>
      <LoadState state={state}>
        {r && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
              <StatCard compact icon={UserPlus} tone="teal" label={t('adminReports.newPatients')} value={r.users.newPatients} />
              <StatCard compact icon={Stethoscope} tone="blue" label={t('adminReports.newDoctors')} value={r.users.newDoctors} />
              <StatCard compact icon={Users} tone="purple" label={t('adminReports.totalPatients')} value={r.users.totalPatients} />
              <StatCard compact icon={Stethoscope} tone="green" label={t('adminReports.activeDoctors')} value={r.users.activeDoctors} />
              <StatCard compact icon={CalendarCheck} tone="teal" label={t('adminReports.appointments')} value={r.appointments.total} />
              <StatCard compact icon={CheckCircle2} tone="green" label={t('adminReports.completionRate')} value={pct(r.appointments.completionRate)} />
              <StatCard compact icon={UserX} tone="gold" label={t('adminReports.noShowRate')} value={pct(r.appointments.noShowRate)} />
              <StatCard compact icon={CalendarX2} tone="purple" label={t('adminReports.cancellationRate')} value={pct(r.appointments.cancellationRate)} />
            </div>

            <Card className="mb-4 p-5" data-activity-trend>
              <h3 className="mb-1 text-base font-bold">{t(r.granularity === 'day' ? 'adminReports.trendDaily' : 'adminReports.trendMonthly')}</h3>
              <p className="mb-3 text-xs text-muted">{t('adminReports.trendHint', { booked: r.appointments.booked })}</p>
              {trend.length < 2 ? <p className="py-8 text-center text-sm text-muted">{t('adminReports.notEnoughData')}</p> : <AreaChart data={trend} ticks={countTicks(max)} width={720} height={220} />}
            </Card>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="p-5">
                <h3 className="mb-3 text-base font-bold">{t('adminReports.byStatus')}</h3>
                <ul className="space-y-1.5 text-sm">
                  {Object.entries(r.appointments.byStatus)
                    .sort(([, a], [, b]) => b - a)
                    .map(([s, n]) => (
                      <li key={s} className="flex justify-between gap-3">
                        <Link to={`/admin/appointments?status=${s}`} className="hover:text-primary">
                          {t(`apptStatus.${s}`)}
                        </Link>
                        <span className="font-bold">{n}</span>
                      </li>
                    ))}
                  {r.appointments.total === 0 && <li className="text-muted">{t('adminReports.none')}</li>}
                </ul>
              </Card>
              <Card className="p-5">
                <h3 className="mb-3 text-base font-bold">{t('adminReports.topSpecialties')}</h3>
                <ol className="space-y-1.5 text-sm">
                  {r.topSpecialties.map((s) => (
                    <li key={s.id ?? 'none'} className="flex justify-between gap-3">
                      <span>{(lang === 'so' ? s.nameSo : s.nameEn) ?? '—'}</span>
                      <span className="font-bold">{s.count}</span>
                    </li>
                  ))}
                  {r.topSpecialties.length === 0 && <li className="text-muted">{t('adminReports.none')}</li>}
                </ol>
              </Card>
              <Card className="p-5">
                <h3 className="mb-3 text-base font-bold">{t('adminReports.topDoctors')}</h3>
                <ol className="space-y-1.5 text-sm">
                  {r.topDoctors.map((d) => (
                    <li key={d.id} className="flex justify-between gap-3">
                      <span className="truncate">{d.name}</span>
                      <span className="font-bold">{d.count}</span>
                    </li>
                  ))}
                  {r.topDoctors.length === 0 && <li className="text-muted">{t('adminReports.none')}</li>}
                </ol>
              </Card>
            </div>
            <p className="mt-3 text-2xs text-muted">{t('adminReports.note')}</p>
          </>
        )}
      </LoadState>
    </>
  );
}
