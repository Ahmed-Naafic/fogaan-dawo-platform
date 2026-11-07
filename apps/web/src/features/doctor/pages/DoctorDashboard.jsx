import { useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { ArrowRight, CalendarDays, ChevronRight, CircleCheck, Database, Hourglass, Users, Video } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { Select } from '@/components/ui/Input';
import StatCard from '@/components/ui/StatCard';
import { useI18n } from '@/lib/i18n';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { getDoctorStats, getTodaysAppointments } from '@/services';
import ProfessionalProfileCard from '../components/ProfessionalProfileCard';

const STATUS = {
  inSession: { tone: 'teal', icon: Video, chip: 'bg-primary-soft text-primary' },
  waiting: { tone: 'gold', icon: Hourglass, chip: 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300' },
  upcoming: { tone: 'blue', icon: CalendarDays, chip: 'bg-violet-50 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300' },
};

/* Tinted stat backgrounds from the doctor dashboard reference */
const tint = {
  blue: 'bg-sky-50/70 border-sky-100 dark:bg-surface dark:border-line',
  gold: 'bg-amber-50/70 border-amber-100 dark:bg-surface dark:border-line',
  green: 'bg-emerald-50/70 border-emerald-100 dark:bg-surface dark:border-line',
  purple: 'bg-violet-50/70 border-violet-100 dark:bg-surface dark:border-line',
};

function TodaysAppointments({ items }) {
  const { t, locale } = useI18n();
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader
        title={t('doctor.todaysAppointments')}
        action={
          <Link to="/doctor/appointments" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            {t('common.viewAll')} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      <ul className="divide-y divide-line">
        {items.map((a) => {
          const st = STATUS[a.status];
          return (
            <li key={a.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <Avatar src={a.avatar} name={a.patient} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{a.patient}</p>
                <p className="truncate text-xs text-muted">
                  {formatTime(a.time, locale)} · {t(`visitType.${a.type}`)}
                </p>
              </div>
              <Badge tone={st.tone} icon={a.status === 'inSession' ? Video : undefined} className="hidden sm:inline-flex">
                {t(`status.${a.status}`)}
              </Badge>
              <Button to={`/consultation/${a.id}`} size="icon" className="!h-9 !w-9" aria-label={t('doctor.startCall', { name: a.patient })}>
                <Video className="h-4 w-4" />
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Schedule({ items }) {
  const { t, locale } = useI18n();
  const [day, setDay] = useState('2026-11-02');
  const days = ['2026-11-02', '2026-11-03', '2026-11-04'];
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader
        title={t('doctor.yourSchedule')}
        action={
          <Select value={day} onChange={(e) => setDay(e.target.value)} className="w-36 [&_select]:h-9 [&_select]:text-xs" aria-label={t('doctor.selectDay')}>
            {days.map((d) => (
              <option key={d} value={d}>
                {new Date(`${d}T12:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })}
              </option>
            ))}
          </Select>
        }
      />
      {day === days[0] ? (
        <ul className="space-y-2.5">
          {items.map((a) => {
            const st = STATUS[a.status];
            const Icon = st.icon;
            return (
              <li key={a.id} className="flex items-center gap-3">
                <span className="w-[150px] shrink-0 whitespace-nowrap rounded-lg bg-subtle px-3 py-2.5 text-xs font-bold">
                  {formatTime(a.time, locale)} – {formatTime(a.end, locale)}
                </span>
                <span className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold', st.chip)}>
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate text-ink">{a.patient}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-line py-10 text-center text-sm text-muted">{t('doctor.noSlots')}</p>
      )}
    </Card>
  );
}

function NextPatient({ apt }) {
  const { t, locale } = useI18n();
  return (
    <section>
      <h2 className="mb-2.5 text-[15px] font-bold">{t('doctor.nextPatient')}</h2>
      <Link to={`/consultation/${apt.id}`} className="card flex items-center gap-3 p-3.5">
        <Avatar src={apt.avatar} name={apt.patient} size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{apt.patient}</p>
          <p className="text-2xs text-muted">{t(`visitType.${apt.type}`)}</p>
          <p className="text-2xs font-medium">
            {formatTime(apt.time, locale)} ({t('doctor.inMinutes', { n: 15 })})
          </p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted" />
      </Link>
    </section>
  );
}

export default function DoctorDashboard() {
  const { user } = useOutletContext();
  const { t, locale } = useI18n();
  const stats = getDoctorStats();
  const appts = getTodaysAppointments();
  const today = new Date('2026-11-02T12:00').toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });

  const cards = [
    { icon: CalendarDays, tone: 'blue', label: t('doctor.stats.today'), short: t('doctor.stats.todayShort'), value: stats.today },
    { icon: Users, tone: 'gold', label: t('doctor.stats.waiting'), short: t('doctor.stats.waitingShort'), value: stats.waiting },
    { icon: CircleCheck, tone: 'green', label: t('doctor.stats.completed'), short: t('doctor.stats.completed'), value: stats.completed },
    { icon: Database, tone: 'purple', label: t('doctor.stats.earnings'), short: t('doctor.stats.earnings'), value: `$${stats.earnings}` },
  ];

  return (
    <>
      <PageHeader
        title={t('doctor.welcome', { name: user.name })}
        mobileTitle={t('doctor.dashboard')}
        subtitle={
          <>
            <span className="lg:hidden">{t('doctor.todayDate', { date: today })}</span>
            <span className="hidden lg:inline">{t('doctor.subtitle')}</span>
          </>
        }
        wave
      />

      {/* Real verification + professional profile (one responsive card for both layouts) */}
      <div className="mb-4 lg:mb-6">
        <ProfessionalProfileCard />
      </div>

      {/* Mobile */}
      <div className="space-y-4 lg:hidden">
        <div className="grid grid-cols-2 gap-2.5">
          {cards.map((c) => (
            <StatCard key={c.label} compact icon={c.icon} tone={c.tone} label={c.short} value={c.value} className={tint[c.tone]} />
          ))}
        </div>
        <Button to="/doctor/appointments" className="w-full">
          {t('doctor.viewSchedule')}
        </Button>
        <NextPatient apt={appts[1]} />
        <TodaysAppointments items={appts} />
      </div>

      {/* Desktop */}
      <div className="hidden space-y-6 lg:block">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {cards.map((c) => (
            <StatCard key={c.label} icon={c.icon} tone={c.tone} label={c.label} value={c.value} className={tint[c.tone]} />
          ))}
        </div>
        <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
          <TodaysAppointments items={appts} />
          <Schedule items={appts} />
        </div>
      </div>
    </>
  );
}
