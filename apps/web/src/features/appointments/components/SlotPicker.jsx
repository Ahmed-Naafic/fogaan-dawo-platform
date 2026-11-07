import { useEffect, useState } from 'react';
import { CalendarDays, Globe } from 'lucide-react';
import { getDoctorSlots } from '@/features/doctors/services/doctorDirectoryApi';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { browserTimeZone, civilDay, civilWeekday, formatTime, zoneLabel } from '@/lib/timezone';

const DAYS = 7;

/**
 * Real open slots of a doctor: a date strip and the times of the chosen date, grouped and shown in
 * the viewer's zone (or the doctor's, when toggled). Times come from the API in UTC.
 */
export default function SlotPicker({ doctor, value, onChange, className }) {
  const { t, locale } = useI18n();
  const viewerZone = browserTimeZone();
  const doctorZone = doctor.timeZone ?? null;
  const [zone, setZone] = useState(viewerZone);
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [day, setDay] = useState(null);

  useEffect(() => {
    let live = true;
    setData(null);
    setFailed(false);
    getDoctorSlots(doctor.id, { days: DAYS, tz: zone })
      .then((d) => {
        if (!live) return;
        setData(d);
        setDay((current) => (d.days.some((x) => x.date === current && x.slots.length) ? current : (d.days.find((x) => x.slots.length)?.date ?? d.days[0]?.date ?? null)));
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [doctor.id, zone]);

  const selected = data?.days.find((d) => d.date === day);
  const anyOpen = data?.days.some((d) => d.slots.length);

  return (
    <div className={className}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-bold">
          <CalendarDays className="h-4 w-4 text-primary" /> {t('booking.selectDate')}
        </p>
        {doctorZone && doctorZone !== viewerZone && (
          <div className="flex rounded-lg bg-subtle p-0.5 text-2xs font-semibold" role="group" aria-label={t('booking.timeZoneToggle')}>
            {[
              [viewerZone, t('booking.yourTime')],
              [doctorZone, t('booking.doctorTime')],
            ].map(([z, label]) => (
              <button key={z} type="button" aria-pressed={zone === z} onClick={() => setZone(z)} className={cn('rounded-md px-2 py-1 transition-colors', zone === z ? 'bg-surface text-ink shadow-sm' : 'text-muted')}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {failed ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{t('booking.loadError')}</p>
      ) : !data ? (
        <div className="space-y-3" aria-busy="true">
          <div className="h-16 animate-pulse rounded-xl bg-subtle" />
          <div className="h-20 animate-pulse rounded-xl bg-subtle" />
        </div>
      ) : (
        <>
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none" role="tablist" aria-label={t('booking.selectDate')}>
            {data.days.map((d) => {
              const open = d.slots.length > 0;
              return (
                <button
                  key={d.date}
                  type="button"
                  role="tab"
                  aria-selected={d.date === day}
                  disabled={!open}
                  onClick={() => setDay(d.date)}
                  className={cn(
                    'flex w-14 shrink-0 flex-col items-center rounded-xl border py-2.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    d.date === day ? 'border-primary bg-primary text-primary-fg shadow-glow' : 'border-line bg-surface hover:bg-subtle',
                  )}
                >
                  <span className={cn('text-2xs font-semibold', d.date === day ? 'opacity-90' : 'text-muted')}>{civilWeekday(d.date, locale)}</span>
                  <span className="text-base font-extrabold">{civilDay(d.date)}</span>
                </button>
              );
            })}
          </div>

          <p className="mb-2.5 mt-5 text-sm font-bold">{t('booking.selectTime')}</p>
          {!anyOpen ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{t('booking.noSlots')}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="listbox" aria-label={t('booking.selectTime')}>
              {selected?.slots.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={value?.id === s.id}
                  onClick={() => onChange?.(s)}
                  className={cn('rounded-lg border py-2 text-xs font-bold transition-colors', value?.id === s.id ? 'border-primary bg-primary-soft text-primary' : 'border-line hover:bg-subtle')}
                >
                  {formatTime(s.startAtUtc, zone, locale)}
                </button>
              ))}
            </div>
          )}
          <p className="mt-3 flex items-center gap-1.5 text-2xs text-muted">
            <Globe className="h-3.5 w-3.5" /> {t('booking.shownIn', { zone: zoneLabel(zone) })}
          </p>
        </>
      )}
    </div>
  );
}
