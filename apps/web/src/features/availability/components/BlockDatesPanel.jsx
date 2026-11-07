import { useState } from 'react';
import { CalendarOff, CalendarPlus, Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import IconTile from '@/components/ui/IconTile';
import { Input } from '@/components/ui/Input';
import Tabs from '@/components/ui/Tabs';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { formatCivilDate, todayIn } from '@/lib/timezone';
import { describeBlock, validateBlock } from '../availabilityForm';

const DATE_INPUT =
  'h-11 w-full rounded-xl border border-line bg-subtle px-3 text-sm font-medium text-ink outline-none transition-colors focus:border-primary focus:bg-surface focus:ring-4 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50 [color-scheme:light] dark:[color-scheme:dark]';

function Field({ label, error, children }) {
  const { t } = useI18n();
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-ink">{label}</span>
      {children}
      {error && <p className="mt-1.5 text-2xs font-medium text-danger">{t(error)}</p>}
    </label>
  );
}

/** "Block Dates" tab: block whole days or a time period; list and remove upcoming blocks. */
export default function BlockDatesPanel({ blocks, timeZone, disabled, onAdd, onRemove, busyId }) {
  const { t, locale } = useI18n();
  const today = todayIn(timeZone);
  const empty = { kind: 'DAYS', startDate: today, endDate: '', date: today, startTime: '09:00', endTime: '12:00', reason: '' };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState({});
  const [adding, setAdding] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e) => {
    e.preventDefault();
    const found = validateBlock(form, timeZone);
    setErrors(found);
    if (Object.keys(found).length) return;
    setAdding(true);
    try {
      if (await onAdd(form)) setForm({ ...empty, kind: form.kind });
    } finally {
      setAdding(false);
    }
  };

  const describe = (b) => {
    const d = describeBlock(b, timeZone);
    const fmt = (s) => formatCivilDate(s, locale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    if (d.kind === 'DAYS') return d.startDate === d.endDate ? fmt(d.startDate) : `${fmt(d.startDate)} – ${fmt(d.endDate)}`;
    return `${fmt(d.date)} · ${d.startTime} – ${d.endTime}${d.endDate !== d.date ? ` (${fmt(d.endDate)})` : ''}`;
  };

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Tabs
          items={[
            { value: 'DAYS', label: t('availability.blockDays') },
            { value: 'PERIOD', label: t('availability.blockPeriod') },
          ]}
          value={form.kind}
          onChange={(kind) => {
            set({ kind });
            setErrors({});
          }}
          className="max-w-sm"
        />
        {form.kind === 'DAYS' ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('availability.fromDate')} error={errors.startDate}>
              <input type="date" name="startDate" min={today} value={form.startDate} disabled={disabled} onChange={(e) => set({ startDate: e.target.value })} className={cn(DATE_INPUT, errors.startDate && 'border-danger/70')} />
            </Field>
            <Field label={t('availability.toDate')} error={errors.endDate}>
              <input type="date" name="endDate" min={form.startDate || today} value={form.endDate} disabled={disabled} onChange={(e) => set({ endDate: e.target.value })} className={cn(DATE_INPUT, errors.endDate && 'border-danger/70')} />
            </Field>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('availability.date')} error={errors.date}>
              <input type="date" name="date" min={today} value={form.date} disabled={disabled} onChange={(e) => set({ date: e.target.value })} className={cn(DATE_INPUT, errors.date && 'border-danger/70')} />
            </Field>
            <Field label={t('availability.from')}>
              <input type="time" name="blockStart" step={300} value={form.startTime} disabled={disabled} onChange={(e) => set({ startTime: e.target.value })} className={DATE_INPUT} />
            </Field>
            <Field label={t('availability.to')} error={errors.endTime}>
              <input type="time" name="blockEnd" step={300} value={form.endTime} disabled={disabled} onChange={(e) => set({ endTime: e.target.value })} className={cn(DATE_INPUT, errors.endTime && 'border-danger/70')} />
            </Field>
          </div>
        )}
        <Field label={t('availability.reason')}>
          <Input name="blockReason" maxLength={255} value={form.reason} disabled={disabled} onChange={(e) => set({ reason: e.target.value })} placeholder={t('availability.reasonPlaceholder')} />
        </Field>
        <Button type="submit" disabled={disabled || adding} className="w-full sm:w-auto">
          <CalendarPlus className="h-4 w-4" /> {t('availability.addBlock')}
        </Button>
      </form>

      <div>
        <h3 className="mb-3 text-sm font-bold">{t('availability.upcomingBlocks')}</h3>
        {blocks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{t('availability.noBlocks')}</p>
        ) : (
          <ul className="space-y-2.5" aria-label={t('availability.upcomingBlocks')}>
            {blocks.map((b) => (
              <li key={b.id} className="flex items-center gap-3 rounded-xl border border-line p-3">
                <IconTile icon={CalendarOff} tone="rose" size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{describe(b)}</p>
                  {b.reason && <p className="truncate text-2xs text-muted">{b.reason}</p>}
                </div>
                <Button variant="ghost" size="sm" onClick={() => onRemove(b)} disabled={disabled || busyId === b.id} aria-label={t('availability.removeBlockFor', { when: describe(b) })}>
                  <Trash2 className="h-4 w-4" /> <span className="hidden sm:inline">{t('availability.removeBlock')}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
