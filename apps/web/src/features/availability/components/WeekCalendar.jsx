import { useEffect, useState } from 'react';
import { CalendarOff, ChevronLeft, ChevronRight } from 'lucide-react';
import Card, { CardHeader } from '@/components/ui/Card';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { addCivilDays, civilDay, civilWeekday, formatCivilDate, formatTime, todayIn, zoneLabel } from '@/lib/timezone';
import { getMyCalendar } from '../services/availabilityApi';

const STATUS_CLASS = {
  AVAILABLE: 'bg-primary-soft text-primary',
  HELD: 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
  BOOKED: 'bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300',
};

/** Monday of the week containing `date` (civil date). */
function mondayOf(date) {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addCivilDays(date, -((dow + 6) % 7));
}

/** The doctor's published slots for one week, shown in the schedule's zone. */
export default function WeekCalendar({ timeZone, refreshKey }) {
  const { t, locale } = useI18n();
  const today = todayIn(timeZone);
  const [weekStart, setWeekStart] = useState(() => mondayOf(today));
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => setWeekStart(mondayOf(todayIn(timeZone))), [timeZone]);
  useEffect(() => {
    let live = true;
    setFailed(false);
    getMyCalendar({ from: weekStart, days: 7, tz: timeZone })
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [weekStart, timeZone, refreshKey]);

  const blockedOn = (date) =>
    (data?.blocks ?? []).some((b) => {
      const start = todayIn(timeZone, new Date(b.startAt));
      const endInstant = new Date(new Date(b.endAt).getTime() - 1);
      return start <= date && date <= todayIn(timeZone, endInstant);
    });
  const total = (data?.days ?? []).reduce((n, d) => n + d.slots.filter((s) => s.status === 'AVAILABLE').length, 0);
  const isCurrentWeek = weekStart === mondayOf(today);

  return (
    <Card className="p-5 sm:p-6">
      <CardHeader
        title={t('availability.calendarTitle')}
        subtitle={`${formatCivilDate(weekStart, locale, { month: 'short', day: 'numeric' })} – ${formatCivilDate(addCivilDays(weekStart, 6), locale, { month: 'short', day: 'numeric', year: 'numeric' })}`}
        action={
          <div className="flex items-center gap-1">
            <button type="button" disabled={isCurrentWeek} onClick={() => setWeekStart((w) => addCivilDays(w, -7))} className="rounded-lg border border-line p-1.5 hover:bg-subtle disabled:opacity-40" aria-label={t('availability.prevWeek')}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setWeekStart((w) => addCivilDays(w, 7))} className="rounded-lg border border-line p-1.5 hover:bg-subtle" aria-label={t('availability.nextWeek')}>
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        }
      />
      <p className="-mt-2 mb-4 text-2xs text-muted">{t('availability.shownIn', { zone: zoneLabel(timeZone) })}</p>
      {failed ? (
        <p className="text-sm text-muted">{t('availability.calendarError')}</p>
      ) : !data ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-subtle" />
          ))}
        </div>
      ) : (
        <>
          <ol className="space-y-2.5" aria-label={t('availability.calendarTitle')}>
            {data.days.map((d) => {
              const blocked = blockedOn(d.date);
              return (
                <li key={d.date} className={cn('flex gap-3 rounded-xl border border-line p-2.5', d.date === today && 'border-primary/50 bg-primary-soft/30')}>
                  <div className="w-10 shrink-0 text-center">
                    <p className="text-2xs font-semibold uppercase text-muted">{civilWeekday(d.date, locale)}</p>
                    <p className="text-base font-extrabold">{civilDay(d.date)}</p>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap content-center gap-1.5">
                    {d.slots.length === 0 && !blocked && <span className="text-2xs text-muted">{t('availability.noSlotsDay')}</span>}
                    {blocked && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-2xs font-semibold text-rose-700 dark:bg-rose-400/10 dark:text-rose-300">
                        <CalendarOff className="h-3 w-3" /> {t('availability.blocked')}
                      </span>
                    )}
                    {d.slots.map((s) => (
                      <span key={s.id} className={cn('rounded-md px-2 py-1 text-2xs font-bold', STATUS_CLASS[s.status] ?? 'bg-subtle text-muted line-through')} title={t(`availability.slotStatus.${s.status}`)}>
                        {formatTime(s.startAtUtc, timeZone, locale)}
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="mt-4 text-xs font-semibold text-muted">{t('availability.openThisWeek', { count: total })}</p>
        </>
      )}
    </Card>
  );
}
