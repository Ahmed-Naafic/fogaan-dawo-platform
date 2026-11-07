import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CalendarDays, ChevronRight, Clock3, Timer } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import { specialtyLabel } from '@/features/doctors/doctorDirectory';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { browserTimeZone, formatTime } from '@/lib/timezone';
import { APPOINTMENT_TONE, formatCountdown, remainingMs } from '../booking';
import usePrivateImage from '@/features/profile/usePrivateImage';

export function AppointmentStatusBadge({ status }) {
  const { t } = useI18n();
  return <Badge tone={APPOINTMENT_TONE[status] ?? 'neutral'}>{t(`apptStatus.${status}`)}</Badge>;
}

/** "Tue, Nov 10 · 9:00 – 9:30 AM" in the viewer's zone. */
export function AppointmentWhen({ startAtUtc, endAtUtc, className }) {
  const { locale } = useI18n();
  const tz = browserTimeZone();
  const day = new Date(startAtUtc).toLocaleDateString(locale, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      <span className="inline-flex items-center gap-1.5">
        <CalendarDays className="h-3.5 w-3.5" /> {day}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Clock3 className="h-3.5 w-3.5" /> {formatTime(startAtUtc, tz, locale)} – {formatTime(endAtUtc, tz, locale)}
      </span>
    </span>
  );
}

/** One appointment in a list (patient sees the doctor, doctor sees the patient). */
export function AppointmentRow({ item, href, viewer }) {
  const { t, lang } = useI18n();
  const name = viewer === 'PATIENT' ? item.doctor.name : item.patient.name;
  const sub = viewer === 'PATIENT' ? specialtyLabel(item.doctor.specialty, lang) : item.reason || t('appointments.noReason');
  const photo = usePrivateImage(viewer === 'DOCTOR' ? item.patient?.photoUrl : null);
  return (
    <Link to={href} className="card flex items-center gap-3.5 p-4 transition-shadow hover:shadow-float" data-appointment={item.id}>
      <Avatar src={photo} name={name} size="lg" className="ring-2 ring-primary-soft" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-[15px] font-bold">
          <span className="truncate">{name}</span>
          <AppointmentStatusBadge status={item.status} />
          {item.rescheduled && <Badge tone="purple">{t('appointments.rescheduledBadge')}</Badge>}
        </p>
        <p className="truncate text-sm text-muted">{sub}</p>
        <AppointmentWhen startAtUtc={item.startAtUtc} endAtUtc={item.endAtUtc} className="mt-1 text-xs text-muted" />
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
    </Link>
  );
}

/**
 * Live countdown of a reservation's payment window. Uses the server time from the response, so a wrong
 * device clock cannot extend or shorten the hold. Calls onExpire once when it reaches zero.
 */
export function HoldCountdown({ holdExpiresAt, serverTime, receivedAt, onExpire }) {
  const { t } = useI18n();
  const [ms, setMs] = useState(() => remainingMs(holdExpiresAt, { serverTime, receivedAt }));
  useEffect(() => {
    const tick = () => {
      const left = remainingMs(holdExpiresAt, { serverTime, receivedAt });
      setMs(left);
      if (left <= 0) {
        clearInterval(id);
        onExpire?.();
      }
    };
    const id = setInterval(tick, 1000);
    tick();
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only for a new hold
  }, [holdExpiresAt, serverTime, receivedAt]);
  const urgent = ms < 2 * 60_000;
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl border p-4', urgent ? 'border-rose-200 bg-rose-50 dark:border-rose-400/30 dark:bg-rose-400/10' : 'border-amber-200 bg-amber-50 dark:border-amber-400/30 dark:bg-amber-400/10')} role="timer" aria-live="off">
      <Timer className={cn('h-6 w-6 shrink-0', urgent ? 'text-rose-600 dark:text-rose-300' : 'text-amber-600 dark:text-amber-300')} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-ink">{t('appointments.holdTitle')}</p>
        <p className="text-xs text-muted">{t('appointments.holdBody')}</p>
      </div>
      <span className={cn('font-mono text-2xl font-extrabold tabular-nums', urgent ? 'text-rose-600 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300')} data-countdown>
        {formatCountdown(ms)}
      </span>
    </div>
  );
}
