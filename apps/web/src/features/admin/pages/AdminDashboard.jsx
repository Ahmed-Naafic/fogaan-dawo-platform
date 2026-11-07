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
import { getAdminStats, getAppointmentsOverview } from '@/services';
import { specialtyName } from '@/features/doctors/doctorApplicationForm';
import { listApplications } from '../services/verificationApi';

function AppointmentsOverview({ compact = false }) {
  const { t } = useI18n();
  const [range, setRange] = useState('thisWeek');
  const data = getAppointmentsOverview(range).map((d) => ({ label: t(`days.${d.day}`), value: d.value }));
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
      <AreaChart data={data} width={compact ? 340 : 560} height={compact ? 190 : 230} />
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
  const s = getAdminStats();
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
    { icon: Users, tone: 'blue', label: t('admin.stats.users'), short: t('admin.stats.usersShort'), value: formatNumber(s.users.value, locale), trend: s.users.trend, trendLabel: t('admin.fromLastMonth') },
    { icon: Stethoscope, tone: 'purple', label: t('admin.stats.doctors'), short: t('admin.stats.doctors'), value: formatNumber(s.doctors.value, locale), trend: s.doctors.trend },
    { icon: CalendarCheck, tone: 'green', label: t('admin.stats.appointments'), short: t('admin.stats.appointments'), value: formatNumber(s.appointments.value, locale), trend: s.appointments.trend },
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
