import { useState } from 'react';
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
import { getAdminStats, getAppointmentsOverview, getPendingDoctors } from '@/services';

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

function DoctorVerification() {
  const { t, locale } = useI18n();
  const pending = getPendingDoctors();
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
      <ul className="divide-y divide-line">
        {pending.map((d) => (
          <li key={d.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <Avatar src={d.avatar} name={d.name} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{d.name}</p>
              <p className="text-xs text-muted">{t(`specialist.${d.specialty}`)}</p>
              <p className="text-2xs text-muted lg:hidden">
                {t('admin.submitted', { date: new Date(`${d.submitted}T12:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }) })}
              </p>
            </div>
            <Button to="/admin/verification" variant="secondary" size="sm" className="hidden sm:inline-flex">
              {t('admin.review')}
            </Button>
            <ChevronRight className="h-5 w-5 text-muted sm:hidden" />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function AdminDashboard() {
  const { t, locale } = useI18n();
  const s = getAdminStats();
  const cards = [
    { icon: Users, tone: 'blue', label: t('admin.stats.users'), short: t('admin.stats.usersShort'), value: formatNumber(s.users.value, locale), trend: s.users.trend, trendLabel: t('admin.fromLastMonth') },
    { icon: Stethoscope, tone: 'purple', label: t('admin.stats.doctors'), short: t('admin.stats.doctors'), value: formatNumber(s.doctors.value, locale), trend: s.doctors.trend },
    { icon: CalendarCheck, tone: 'green', label: t('admin.stats.appointments'), short: t('admin.stats.appointments'), value: formatNumber(s.appointments.value, locale), trend: s.appointments.trend },
    { icon: Database, tone: 'gold', label: t('admin.stats.revenue'), short: t('admin.stats.revenue'), value: `$${formatNumber(s.revenue.value, locale)}`, trend: s.revenue.trend },
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
        <DoctorVerification />
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
          <DoctorVerification />
        </div>
      </div>
    </>
  );
}
