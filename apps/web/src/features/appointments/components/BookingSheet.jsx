import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, CalendarDays, Video, X } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Rating from '@/components/shared/Rating';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

const SLOTS = ['09:00', '10:30', '12:00', '15:00', '16:30', '18:00', '19:30', '21:00'];

/**
 * Slot picker shown when a patient taps "Book Appointment".
 * Phase 1: selection is local UI state only — confirming does not create a booking.
 */
export default function BookingSheet({ doctor, onClose }) {
  const { t, locale } = useI18n();
  const notify = useToast();
  const days = useMemo(() => {
    const base = new Date();
    return Array.from({ length: 6 }, (_, i) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + i));
  }, []);
  const [day, setDay] = useState(0);
  const [slot, setSlot] = useState(null);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="booking-title">
      <button aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md animate-fade-up rounded-t-3xl border border-line bg-surface p-5 shadow-float sm:rounded-3xl sm:p-6">
        <div className="mb-5 flex items-start justify-between">
          <h2 id="booking-title" className="text-lg font-extrabold">
            {t('booking.title')}
          </h2>
          <button onClick={onClose} className="-mr-2 -mt-1 rounded-lg p-2 text-muted hover:bg-subtle" aria-label={t('common.close')}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-3.5 rounded-2xl bg-subtle p-3.5">
          <Avatar src={doctor.avatar} name={doctor.name} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 font-bold">
              {doctor.name} <BadgeCheck className="h-4 w-4 fill-primary text-surface" />
            </p>
            <p className="text-xs text-muted">{t(`specialist.${doctor.specialty}`)}</p>
            <Rating value={doctor.rating} reviews={doctor.reviews} compact />
          </div>
          <div className="text-right">
            <p className="text-lg font-extrabold">${doctor.fee}</p>
            <p className="text-2xs text-muted">{t('doctors.perConsultation')}</p>
          </div>
        </div>

        <p className="mb-2.5 mt-5 flex items-center gap-2 text-sm font-bold">
          <CalendarDays className="h-4 w-4 text-primary" /> {t('booking.selectDate')}
        </p>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none">
          {days.map((d, i) => (
            <button
              key={d.toISOString()}
              onClick={() => setDay(i)}
              className={cn(
                'flex w-14 shrink-0 flex-col items-center rounded-xl border py-2.5 transition-colors',
                i === day ? 'border-primary bg-primary text-primary-fg shadow-glow' : 'border-line bg-surface hover:bg-subtle',
              )}
            >
              <span className={cn('text-2xs font-semibold', i === day ? 'opacity-90' : 'text-muted')}>
                {d.toLocaleDateString(locale, { weekday: 'short' })}
              </span>
              <span className="text-base font-extrabold">{d.getDate()}</span>
            </button>
          ))}
        </div>

        <p className="mb-2.5 mt-5 text-sm font-bold">{t('booking.selectTime')}</p>
        <div className="grid grid-cols-4 gap-2">
          {SLOTS.map((s, i) => {
            const unavailable = (i + day) % 5 === 0;
            return (
              <button
                key={s}
                disabled={unavailable}
                onClick={() => setSlot(s)}
                className={cn(
                  'rounded-lg border py-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:line-through',
                  slot === s ? 'border-primary bg-primary-soft text-primary' : 'border-line hover:bg-subtle',
                )}
              >
                {s}
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex items-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary-soft/50 px-3.5 py-2.5 text-xs font-semibold text-primary">
          <Video className="h-4 w-4" /> {t('booking.videoNote')}
        </div>

        <Button
          className="mt-5 w-full"
          size="lg"
          disabled={!slot}
          onClick={() => {
            notify(t('booking.phaseNotice'));
            onClose();
          }}
        >
          {slot ? t('booking.confirm', { time: slot }) : t('booking.chooseSlot')}
        </Button>
      </div>
    </div>
  );
}
