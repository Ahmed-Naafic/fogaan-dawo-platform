import { Clock3, Globe, Plus, Save, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Select } from '@/components/ui/Input';
import Toggle from '@/components/ui/Toggle';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { browserTimeZone, timeZoneList, zoneLabel } from '@/lib/timezone';
import { DAY_ORDER, MAX_PERIODS_PER_DAY, nextPeriod, SLOT_DURATIONS, slotsInPeriod, weeklyCapacity } from '../availabilityForm';

const TIME_INPUT =
  'h-10 min-w-0 flex-1 rounded-lg border border-line bg-subtle px-2.5 text-sm sm:w-[8.75rem] sm:flex-none sm:px-2.5 sm:text-sm font-semibold text-ink outline-none transition-colors focus:border-primary focus:bg-surface focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50 [color-scheme:light] dark:[color-scheme:dark]';

const ZONES = timeZoneList();

/**
 * Weekly schedule from the approved "Availability → Weekly Schedule" design: zone, then one row per day.
 * `onChange` receives an updater (prev => next) so quick successive edits never overwrite each other.
 */
export default function WeeklyScheduleEditor({ form, onChange, errors, disabled, saving, dirty, onSave }) {
  const { t } = useI18n();
  const device = browserTimeZone();
  const setDay = (dow, patch) => onChange((f) => ({ ...f, days: { ...f.days, [dow]: { ...f.days[dow], ...(typeof patch === 'function' ? patch(f.days[dow]) : patch) } } }));
  const setPeriod = (dow, i, patch) => setDay(dow, (day) => ({ periods: day.periods.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink">{t('availability.timeZone')}</span>
          <Select icon={Globe} name="timeZone" value={form.timeZone} disabled={disabled} onChange={(e) => {
              const timeZone = e.target.value;
              onChange((f) => ({ ...f, timeZone }));
            }}>
            {(ZONES.includes(form.timeZone) ? ZONES : [form.timeZone, ...ZONES]).map((z) => (
              <option key={z} value={z}>
                {zoneLabel(z)}
              </option>
            ))}
          </Select>
          {device !== form.timeZone && !disabled && (
            <button type="button" onClick={() => onChange((f) => ({ ...f, timeZone: device }))} className="mt-1.5 text-2xs font-semibold text-primary hover:underline">
              {t('availability.useDeviceZone', { zone: zoneLabel(device) })}
            </button>
          )}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink">{t('availability.duration')}</span>
          <Select icon={Clock3} name="slotDurationMinutes" value={String(form.slotDurationMinutes)} disabled={disabled} onChange={(e) => {
              const slotDurationMinutes = Number(e.target.value);
              onChange((f) => ({ ...f, slotDurationMinutes }));
            }}>
            {SLOT_DURATIONS.map((d) => (
              <option key={d} value={d}>
                {t('availability.minutes', { n: d })}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <ul className="divide-y divide-line rounded-2xl border border-line">
        {DAY_ORDER.map((dow) => {
          const day = form.days[dow];
          const add = nextPeriod(day.periods);
          return (
            <li key={dow} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3.5 py-3 sm:flex-nowrap sm:items-start sm:px-4" data-day={dow}>
              <span className={cn('w-11 shrink-0 text-sm font-bold sm:pt-2.5', !day.enabled && 'text-muted')}>{t(`availability.dayShort.${dow}`)}</span>
              <div className="order-last w-full min-w-0 space-y-2 sm:order-none sm:w-auto sm:flex-1">
                {day.enabled ? (
                  <>
                    {day.periods.map((p, i) => {
                      const err = errors[`${dow}.${i}`];
                      return (
                        <div key={i}>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <div className="flex w-full items-center gap-2 sm:w-auto">
                            <input
                              type="time"
                              step={300}
                              value={p.startTime}
                              disabled={disabled}
                              onChange={(e) => setPeriod(dow, i, { startTime: e.target.value })}
                              aria-label={t('availability.startFor', { day: t(`availability.dayLong.${dow}`) })}
                              aria-invalid={!!err}
                              className={cn(TIME_INPUT, err && 'border-danger/70')}
                            />
                            <span className="text-muted">–</span>
                            <input
                              type="time"
                              step={300}
                              value={p.endTime}
                              disabled={disabled}
                              onChange={(e) => setPeriod(dow, i, { endTime: e.target.value })}
                              aria-label={t('availability.endFor', { day: t(`availability.dayLong.${dow}`) })}
                              aria-invalid={!!err}
                              className={cn(TIME_INPUT, err && 'border-danger/70')}
                            />
                            </div>
                            {day.periods.length > 1 && !disabled && (
                              <button
                                type="button"
                                onClick={() => setDay(dow, (d) => ({ periods: d.periods.filter((_, j) => j !== i) }))}
                                className="rounded-lg p-1.5 text-muted hover:bg-subtle hover:text-danger"
                                aria-label={t('availability.removePeriod')}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                            <span className="text-2xs text-muted">{t('availability.slotCount', { count: slotsInPeriod(p, form.slotDurationMinutes) })}</span>
                          </div>
                          {err && <p className="mt-1 text-2xs font-medium text-danger">{t(err)}</p>}
                        </div>
                      );
                    })}
                    {!disabled && add && day.periods.length < MAX_PERIODS_PER_DAY && (
                      <button type="button" onClick={() => setDay(dow, (d) => ({ periods: [...d.periods, nextPeriod(d.periods) ?? add] }))} className="inline-flex items-center gap-1 text-2xs font-semibold text-primary hover:underline">
                        <Plus className="h-3.5 w-3.5" /> {t('availability.addPeriod')}
                      </button>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted sm:pt-2.5">{t('availability.unavailable')}</p>
                )}
              </div>
              <Toggle checked={day.enabled} onChange={(v) => !disabled && setDay(dow, { enabled: v })} label={t('availability.toggleDay', { day: t(`availability.dayLong.${dow}`) })} className="ml-auto sm:ml-0 sm:mt-2" />
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted">{t('availability.capacity', { count: weeklyCapacity(form) })}</p>
        <Button size="lg" className="w-full sm:w-auto" onClick={onSave} disabled={disabled || saving || !dirty}>
          <Save className="h-4 w-4" /> {saving ? t('availability.saving') : t('availability.save')}
        </Button>
      </div>
    </div>
  );
}
