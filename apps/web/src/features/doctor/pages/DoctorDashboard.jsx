import { useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import { ArrowRight, CalendarDays, ChevronRight, CircleCheck, Database, Users } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { Select } from '@/components/ui/Input';
import StatCard from '@/components/ui/StatCard';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { useLoad, formatMoney } from '@/features/finance/financeUi';
import { AppointmentStatusBadge } from '@/features/appointments/components/AppointmentParts';
import usePrivateImage from '@/features/profile/usePrivateImage';
import { browserTimeZone, doctorSummary } from '@/features/dashboard/dashboardApi';
import ProfessionalProfileCard from '../components/ProfessionalProfileCard';

/* Tinted stat backgrounds from the doctor dashboard reference */
const tint = {
  blue: 'bg-sky-50/70 border-sky-100 dark:bg-surface dark:border-line',
  gold: 'bg-amber-50/70 border-amber-100 dark:bg-surface dark:border-line',
  green: 'bg-emerald-50/70 border-emerald-100 dark:bg-surface dark:border-line',
  purple: 'bg-violet-50/70 border-violet-100 dark:bg-surface dark:border-line',
};

const CHIP = {
  IN_PROGRESS: 'bg-primary-soft text-primary',
  WAITING: 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300',
  CONFIRMED: 'bg-violet-50 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300',
};

function useClock(timeZone) {
  const { locale } = useI18n();
  const time = (iso) => new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', timeZone });
  const day = (yyyyMmDd, opts = { month: 'short', day: 'numeric', year: 'numeric' }) => new Date(`${yyyyMmDd}T12:00:00Z`).toLocaleDateString(locale, { ...opts, timeZone: 'UTC' });
  return { time, day };
}

/** The patient's photo through the gated, audited route (only while the appointment allows it). */
function PatientAvatar({ patient, size = 'md' }) {
  const photo = usePrivateImage(patient?.photoUrl ?? null);
  return <Avatar src={photo} name={patient?.name} size={size} />;
}

function Empty({ children }) {
  return <p className="rounded-xl border border-dashed border-line py-10 text-center text-sm text-muted">{children}</p>;
}

function Skeleton() {
  return <div className="h-32 animate-pulse rounded-xl bg-subtle" aria-busy="true" />;
}

function TodaysAppointments({ items, loading, timeZone }) {
  const { t } = useI18n();
  const { time } = useClock(timeZone);
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
      {loading ? (
        <Skeleton />
      ) : items.length === 0 ? (
        <Empty>{t('doctor.noAppointmentsToday')}</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
              <PatientAvatar patient={a.patient} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{a.patient.name}</p>
                <p className="truncate text-xs text-muted">
                  {time(a.startAtUtc)} – {time(a.endAtUtc)}
                  {a.bookingType === 'FOLLOW_UP' ? ` · ${t('doctor.followUp')}` : ''}
                </p>
              </div>
              <span className="hidden sm:inline-flex">
                <AppointmentStatusBadge status={a.status} />
              </span>
              <Button to={`/doctor/appointments/${a.id}`} size="icon" variant="secondary" className="!h-9 !w-9" aria-label={t('doctor.openAppointment', { name: a.patient.name })}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Schedule({ data, loading }) {
  const { t } = useI18n();
  const { time, day: formatDay } = useClock(data?.timeZone);
  const [picked, setPicked] = useState(null);
  const days = data?.days ?? [];
  const day = picked ?? days[0];
  const items = (data?.schedule ?? []).filter((a) => a.day === day);
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader
        title={t('doctor.yourSchedule')}
        action={
          days.length > 0 && (
            <Select value={day} onChange={(e) => setPicked(e.target.value)} className="w-36 [&_select]:h-9 [&_select]:text-xs" aria-label={t('doctor.selectDay')}>
              {days.map((d) => (
                <option key={d} value={d}>
                  {formatDay(d)}
                </option>
              ))}
            </Select>
          )
        }
      />
      {loading ? (
        <Skeleton />
      ) : items.length === 0 ? (
        <Empty>{t('doctor.noSlots')}</Empty>
      ) : (
        <ul className="space-y-2.5">
          {items.map((a) => (
            <li key={a.id}>
              <Link to={`/doctor/appointments/${a.id}`} className="flex items-center gap-3">
                <span className="w-[150px] shrink-0 whitespace-nowrap rounded-lg bg-subtle px-3 py-2.5 text-xs font-bold">
                  {time(a.startAtUtc)} – {time(a.endAtUtc)}
                </span>
                <span className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold', CHIP[a.status] ?? CHIP.CONFIRMED)}>
                  <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate text-ink">{a.patient.name}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function NextPatient({ apt, timeZone, serverTime }) {
  const { t } = useI18n();
  const { time } = useClock(timeZone);
  if (!apt) return null;
  const minutes = Math.round((Date.parse(apt.startAtUtc) - Date.parse(serverTime)) / 60_000);
  return (
    <section>
      <h2 className="mb-2.5 text-[15px] font-bold">{t('doctor.nextPatient')}</h2>
      <Link to={`/doctor/appointments/${apt.id}`} className="card flex items-center gap-3 p-3.5">
        <PatientAvatar patient={apt.patient} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">{apt.patient.name}</p>
          <p className="text-2xs font-medium">
            {time(apt.startAtUtc)}
            {minutes > 0 && minutes < 24 * 60 ? ` (${t('doctor.inMinutes', { n: minutes })})` : ''}
          </p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted" />
      </Link>
    </section>
  );
}

export default function DoctorDashboard() {
  const { user } = useOutletContext();
  const { t } = useI18n();
  const state = useLoad(() => doctorSummary(browserTimeZone()), []);
  const data = state.data;
  const loading = state.loading && !data;
  const { day: formatDay } = useClock(data?.timeZone);
  const s = data?.stats;
  const todays = (data?.schedule ?? []).filter((a) => a.day === data?.today);
  const earnings = s?.earnings30d;

  const cards = [
    { icon: CalendarDays, tone: 'blue', label: t('doctor.stats.today'), short: t('doctor.stats.todayShort'), value: s ? s.today : '—' },
    { icon: Users, tone: 'gold', label: t('doctor.stats.waiting'), short: t('doctor.stats.waitingShort'), value: s ? s.waiting : '—' },
    { icon: CircleCheck, tone: 'green', label: t('doctor.stats.completed30'), short: t('doctor.stats.completed'), value: s ? s.completed30d : '—' },
    { icon: Database, tone: 'purple', label: t('doctor.stats.earnings30'), short: t('doctor.stats.earnings'), value: earnings ? formatMoney(earnings.amount, earnings.currency) : '—' },
  ];

  return (
    <>
      <PageHeader
        title={t('doctor.welcome', { name: user.name })}
        mobileTitle={t('doctor.dashboard')}
        subtitle={
          <>
            <span className="lg:hidden">{data ? t('doctor.todayDate', { date: formatDay(data.today) }) : t('doctor.subtitle')}</span>
            <span className="hidden lg:inline">{t('doctor.subtitle')}</span>
          </>
        }
        wave
      />

      {/* Real verification + professional profile (one responsive card for both layouts) */}
      <div className="mb-4 lg:mb-6">
        <ProfessionalProfileCard />
      </div>

      {state.error && (
        <div className="card mb-4 p-4 text-sm text-danger" role="alert">
          {t('dashboard.loadError')}{' '}
          <button type="button" className="font-semibold underline" onClick={state.reload}>
            {t('dashboard.retry')}
          </button>
        </div>
      )}

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
        <NextPatient apt={data?.schedule?.[0]} timeZone={data?.timeZone} serverTime={data?.serverTime} />
        <TodaysAppointments items={todays} loading={loading} timeZone={data?.timeZone} />
      </div>

      {/* Desktop */}
      <div className="hidden space-y-6 lg:block">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {cards.map((c) => (
            <StatCard key={c.label} icon={c.icon} tone={c.tone} label={c.label} value={c.value} className={tint[c.tone]} />
          ))}
        </div>
        <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
          <TodaysAppointments items={todays} loading={loading} timeZone={data?.timeZone} />
          <Schedule data={data} loading={loading} />
        </div>
      </div>
    </>
  );
}
