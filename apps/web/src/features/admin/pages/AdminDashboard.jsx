import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CalendarCheck, ChevronRight, Database, Stethoscope, Users } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { Select } from '@/components/ui/Input';
import StatCard from '@/components/ui/StatCard';
import { AreaChart } from '@/components/ui/charts';
import { useI18n } from '@/lib/i18n';
import { formatNumber } from '@/lib/format';
import { overview as financeOverview } from '@/features/finance/services/financeApi';
import { formatMoney } from '@/features/finance/financeUi';
import { useLoad } from '@/features/finance/financeUi';
import { browserTimeZone } from '@/features/dashboard/dashboardApi';
import { reportOverview } from '../services/adminConsoleApi';
import { specialtyName } from '@/features/doctors/doctorApplicationForm';
import { listApplications } from '../services/verificationApi';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const iso = (d) => d.toISOString().slice(0, 10);

/** Monday–Sunday (YYYY-MM-DD) of this week or last week, as calendar days in the viewer's zone. */
export function weekRange(which, now = new Date(), timeZone = browserTimeZone()) {
  const today = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)}T00:00:00Z`);
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 86_400_000 - (which === 'lastWeek' ? 7 * 86_400_000 : 0));
  return { fromDate: iso(monday), toDate: iso(new Date(monday.getTime() + 6 * 86_400_000)) };
}

/** Appointments per day (by start time) from the activity report — this week or last week. */
function AppointmentsOverview({ compact = false }) {
  const { t } = useI18n();
  const [range, setRange] = useState('thisWeek');
  const state = useLoad(() => reportOverview({ preset: 'custom', ...weekRange(range), tz: browserTimeZone() }), [range]);
  const data = (state.data?.trend ?? []).map((d) => ({ label: t(`days.${DAY_KEYS[new Date(`${d.period}T12:00:00Z`).getUTCDay()]}`), value: d.appointments }));
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader
        title={compact ? t('admin.appointmentsTrend') : t('admin.appointmentsOverview')}
        action={
          <Select value={range} onChange={(e) => setRange(e.target.value)} className="w-40 [&_select]:h-9 [&_select]:text-xs" aria-label={t('admin.range')}>
            <option value="thisWeek">{t('admin.thisWeek')}</option>
            <option value="lastWeek">{t('admin.lastWeek')}</option>
          </Select>
        }
      />
      {state.error ? (
        <p className="py-10 text-center text-sm text-danger">{t('dashboard.loadError')}</p>
      ) : state.loading && !state.data ? (
        <div className={compact ? 'h-[190px] animate-pulse rounded-xl bg-subtle' : 'h-[230px] animate-pulse rounded-xl bg-subtle'} aria-busy="true" />
      ) : (
        <>
          <AreaChart data={data} width={compact ? 340 : 560} height={compact ? 190 : 230} />
          <p className="mt-2 text-right text-2xs text-muted">{t('admin.weekTotal', { count: data.reduce((n, d) => n + d.value, 0) })}</p>
        </>
      )}
    </Card>
  );
}

/** Real pending applications (top 3), in the approved card layout. `items`: undefined = loading. */
function DoctorVerification({ items }) {
  const { t, lang, locale } = useI18n();
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader
        title={t('admin.doctorVerification')}
        action={
          <Link to="/admin/verification" className="text-xs font-semibold text-primary hover:underline">
            {t('common.viewAll')}
          </Link>
        }
      />
      {items === undefined ? (
        <div className="h-32 animate-pulse rounded-xl bg-subtle" aria-busy="true" />
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">{t('verification.empty.pending')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((d) => (
            <li key={d.doctorId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <Avatar name={d.name} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{d.name}</p>
                <p className="text-xs text-muted">{specialtyName(d.specialty, lang)}</p>
                <p className="text-2xs text-muted lg:hidden">
                  {t('admin.submitted', { date: d.submittedAt ? new Date(d.submittedAt).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }) : '—' })}
                </p>
              </div>
              <Button to={`/admin/verification/${d.doctorId}`} variant="secondary" size="sm" className="hidden sm:inline-flex">
                {t('admin.review')}
              </Button>
              <Link to={`/admin/verification/${d.doctorId}`} aria-label={t('admin.review')} className="sm:hidden">
                <ChevronRight className="h-5 w-5 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function AdminDashboard() {
  const [pendingApplications, setPendingApplications] = useState(undefined);
  useEffect(() => {
    let cancelled = false;
    listApplications('pending')
      .then((d) => !cancelled && setPendingApplications(d.items.slice(0, 3)))
      .catch(() => !cancelled && setPendingApplications([]));
    return () => {
      cancelled = true;
    };
  }, []);
  const { t, locale } = useI18n();
  // Real activity figures (last 30 days) from the admin reports API.
  const overview = useLoad(() => reportOverview({ preset: '30d', tz: browserTimeZone() }), []);
  const o = overview.data;
  const plus = (n) => (n > 0 ? `+${formatNumber(n, locale)}` : null);
  const [gross30, setGross30] = useState(null);
  useEffect(() => {
    let live = true;
    financeOverview({ preset: '30d' })
      .then((o) => live && setGross30(o.grossVolume.amount))
      .catch(() => live && setGross30(false));
    return () => {
      live = false;
    };
  }, []);
  const cards = [
    { icon: Users, tone: 'blue', label: t('admin.stats.patients'), short: t('admin.stats.patientsShort'), value: o ? formatNumber(o.users.totalPatients, locale) : '—', trend: o ? plus(o.users.newPatients) : null, trendLabel: t('admin.last30Days') },
    { icon: Stethoscope, tone: 'purple', label: t('admin.stats.activeDoctors'), short: t('admin.stats.doctors'), value: o ? formatNumber(o.users.activeDoctors, locale) : '—', trend: o ? plus(o.users.newDoctors) : null, trendLabel: t('admin.last30Days') },
    { icon: CalendarCheck, tone: 'green', label: t('admin.stats.appointments30'), short: t('admin.stats.appointments'), value: o ? formatNumber(o.appointments.total, locale) : '—', trend: null },
    // Real figure from the finance API (simulated payments), never sample data.
    { icon: Database, tone: 'gold', label: t('finance.cards.gross30'), short: t('finance.cards.gross30'), value: gross30 ? formatMoney(gross30) : '—', trend: null },
  ];

  return (
    <>
      <PageHeader title={t('admin.title')} subtitle={t('admin.subtitle')} />

      {/* Mobile */}
      <div className="space-y-4 lg:hidden">
        <div className="grid grid-cols-2 gap-2.5">
          {cards.map((c) => (
            <StatCard key={c.label} compact label={c.short} value={c.value} trend={c.trend} />
          ))}
        </div>
        <AppointmentsOverview compact />
        <DoctorVerification items={pendingApplications} />
      </div>

      {/* Desktop */}
      <div className="hidden space-y-6 lg:block">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {cards.map((c) => (
            <StatCard key={c.label} {...c} />
          ))}
        </div>
        <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
          <AppointmentsOverview />
          <DoctorVerification items={pendingApplications} />
        </div>
      </div>
    </>
  );
}
