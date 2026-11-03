import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router';
import {
  CalendarDays,
  CalendarHeart,
  ChevronRight,
  CircleCheck,
  Clock3,
  FileText,
  FolderOpen,
  MessageSquareMore,
  Search,
  UserRoundSearch,
  Video,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import IconTile from '@/components/ui/IconTile';
import { Input } from '@/components/ui/Input';
import StatCard from '@/components/ui/StatCard';
import { getSpecialtyIcon } from '@/components/shared/SpecialtyIcon';
import BookingSheet from '@/features/appointments/components/BookingSheet';
import { useI18n } from '@/lib/i18n';
import { formatDate, greetingKey } from '@/lib/format';
import { getNextAppointment, getPatientStats, getSpecialties } from '@/services';
import { cn } from '@/lib/cn';

function NextAppointmentCard({ apt, onReschedule }) {
  const { t, locale } = useI18n();
  const time = new Date(apt.date).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader title={t('patient.nextAppointment')} />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex flex-1 items-center gap-4">
          <Avatar src={apt.doctor.avatar} name={apt.doctor.name} size="xl" className="!h-20 !w-20 ring-4 ring-primary-soft" />
          <div className="min-w-0 space-y-1">
            <p className="text-base font-bold">{apt.doctor.name}</p>
            <p className="text-sm text-muted">{t(`specialist.${apt.doctor.specialty}`)}</p>
            <p className="flex items-center gap-2 pt-1 text-[13px]">
              <CalendarDays className="h-4 w-4 text-muted" /> {formatDate(apt.date, locale)}
            </p>
            <p className="flex items-center gap-2 text-[13px]">
              <Clock3 className="h-4 w-4 text-muted" /> {time} ({t('patient.minutes', { n: apt.durationMin })})
            </p>
          </div>
        </div>
        <div className="flex gap-2.5 sm:w-44 sm:flex-col [&>*]:whitespace-nowrap">
          <Button to={`/consultation/${apt.id}`} className="flex-1 sm:flex-none">
            {t('patient.joinCall')}
          </Button>
          <Button variant="secondary" className="flex-1 sm:flex-none" onClick={onReschedule}>
            {t('patient.reschedule')}
          </Button>
        </div>
      </div>
      <span className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary">
        <Video className="h-4 w-4" /> {t('patient.videoConsultation')}
      </span>
    </Card>
  );
}

function FindDoctorCard() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const primary = getSpecialties().filter((s) => s.primary);
  return (
    <Card className="p-5 sm:p-6">
      <CardHeader title={t('patient.findDoctor')} subtitle={t('patient.findDoctorSub')} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          navigate(`/patient/doctors${q ? `?q=${encodeURIComponent(q)}` : ''}`);
        }}
      >
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('patient.searchPlaceholder')}
          aria-label={t('patient.findDoctor')}
          trailing={
            <button type="submit" className="rounded-lg p-1.5 text-ink hover:bg-subtle" aria-label={t('common.search')}>
              <Search className="h-[18px] w-[18px]" />
            </button>
          }
        />
      </form>
      <div className="mt-4 grid grid-cols-4 gap-2.5">
        {primary.map((s) => (
          <Link
            key={s.key}
            to={`/patient/doctors?specialty=${s.key}`}
            className="flex flex-col items-center gap-2 rounded-xl border border-line px-1 py-3 text-center transition-colors hover:border-primary/40 hover:bg-primary-soft/40"
          >
            <IconTile icon={getSpecialtyIcon(s.icon)} tone={s.tone} size="sm" />
            <span className="text-2xs font-semibold">{t(`specialty.${s.key}`)}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

/* ---------- mobile-only blocks (mobile reference) ---------- */

function MobileStats({ stats }) {
  const { t } = useI18n();
  const items = [
    { icon: CalendarHeart, label: 'patient.stats.upcomingShort', value: stats.upcoming, cls: 'bg-primary-soft text-primary' },
    { icon: FileText, label: 'patient.stats.prescriptions', value: stats.prescriptions, cls: 'bg-sky-50 text-sky-600 dark:bg-sky-400/10 dark:text-sky-300' },
    { icon: FolderOpen, label: 'patient.stats.recordsShort', value: stats.records, cls: 'bg-violet-50 text-violet-600 dark:bg-violet-400/10 dark:text-violet-300' },
  ];
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {items.map(({ icon: Icon, label, value, cls }) => (
        <div key={label} className={cn('flex flex-col items-center gap-1 rounded-2xl px-2 py-3.5 text-center', cls)}>
          <Icon className="h-5 w-5" />
          <span className="text-2xs font-semibold text-ink/80">{t(label)}</span>
          <span className="text-xl font-extrabold text-ink">{value}</span>
        </div>
      ))}
    </div>
  );
}

function BookBanner() {
  const { t } = useI18n();
  return (
    <Link
      to="/patient/doctors"
      className="relative flex items-center justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-[#0E857E] to-[#159A91] p-4 text-white shadow-glow dark:from-[#14B8A0] dark:to-[#34E2C6] dark:text-[#042426]"
    >
      <span className="absolute -right-6 -top-10 h-28 w-28 rounded-full bg-white/10" aria-hidden="true" />
      <span className="relative">
        <span className="block text-base font-bold">{t('patient.bookConsultation')}</span>
        <span className="block text-xs opacity-85">{t('patient.bookConsultationSub')}</span>
      </span>
      <ChevronRight className="relative h-5 w-5" />
    </Link>
  );
}

function QuickActions() {
  const { t } = useI18n();
  const items = [
    { to: '/patient/doctors', icon: UserRoundSearch, label: 'nav.findDoctors' },
    { to: '/patient/appointments', icon: CalendarDays, label: 'patient.myVisits' },
    { to: '/patient/messages', icon: MessageSquareMore, label: 'nav.messages' },
  ];
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {items.map(({ to, icon, label }) => (
        <Link key={to} to={to} className="card flex flex-col items-center gap-2 px-2 py-3.5 text-center">
          <IconTile icon={icon} size="sm" round />
          <span className="text-2xs font-semibold">{t(label)}</span>
        </Link>
      ))}
    </div>
  );
}

function MobileNextAppointment({ apt }) {
  const { t, locale } = useI18n();
  const when = new Date(apt.date).toLocaleString(locale, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return (
    <section>
      <h2 className="mb-2.5 text-[15px] font-bold">{t('patient.nextAppointment')}</h2>
      <div className="card flex items-center gap-3 p-3.5">
        <Avatar src={apt.doctor.avatar} name={apt.doctor.name} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold">{apt.doctor.name}</p>
          <p className="text-2xs text-muted">{t(`specialist.${apt.doctor.specialty}`)}</p>
          <p className="mt-0.5 flex items-center gap-1 text-2xs font-medium">
            <CalendarDays className="h-3 w-3 text-primary" /> {when}
          </p>
        </div>
        <Button to={`/consultation/${apt.id}`} size="sm">
          {t('patient.join')}
        </Button>
      </div>
    </section>
  );
}

export default function PatientDashboard() {
  const { user } = useOutletContext();
  const { t } = useI18n();
  const stats = getPatientStats();
  const apt = getNextAppointment();
  const [rescheduling, setRescheduling] = useState(false);

  return (
    <>
      <PageHeader
        title={t(greetingKey(), { name: user.firstName })}
        mobileTitle={t(greetingKey(), { name: user.firstName })}
        subtitle={t('patient.subtitle')}
        wave
      />

      {/* Mobile layout */}
      <div className="space-y-4 lg:hidden">
        <MobileStats stats={stats} />
        <BookBanner />
        <QuickActions />
        <MobileNextAppointment apt={apt} />
      </div>

      {/* Desktop layout */}
      <div className="hidden space-y-6 lg:block">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatCard icon={CalendarDays} tone="teal" label={t('patient.stats.upcoming')} value={stats.upcoming} />
          <StatCard icon={CircleCheck} tone="green" label={t('patient.stats.completed')} value={stats.completed} />
          <StatCard icon={FileText} tone="blue" label={t('patient.stats.prescriptions')} value={stats.prescriptions} />
          <StatCard icon={FolderOpen} tone="blue" label={t('patient.stats.records')} value={stats.records} />
        </div>
        <div className="grid gap-6 xl:grid-cols-[1.15fr_1fr]">
          <NextAppointmentCard apt={apt} onReschedule={() => setRescheduling(true)} />
          <FindDoctorCard />
        </div>
      </div>

      {rescheduling && <BookingSheet doctor={apt.doctor} onClose={() => setRescheduling(false)} />}
    </>
  );
}
