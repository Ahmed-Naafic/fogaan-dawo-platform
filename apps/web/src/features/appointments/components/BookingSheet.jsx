import { useEffect, useState } from 'react';
import { BadgeCheck, Video, X } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Rating from '@/components/shared/Rating';
import { formatFee, specialtyLabel } from '@/features/doctors/doctorDirectory';
import { useI18n } from '@/lib/i18n';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import SlotPicker from './SlotPicker';
import { useReserveSlot } from '../useReserveSlot';

/**
 * Slot picker shown when a patient taps "Book Appointment": the doctor's real open slots. Confirming
 * creates a 10-minute reservation (no payment yet) and opens it with its countdown.
 */
export default function BookingSheet({ doctor, onClose }) {
  const { t, lang, locale } = useI18n();
  const [slot, setSlot] = useState(null);
  const { reserve, busy } = useReserveSlot(doctor.id);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const minutes = slot ? Math.round((new Date(slot.endAtUtc) - new Date(slot.startAtUtc)) / 60_000) : doctor.slotDurationMinutes;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="booking-title">
      <button aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative max-h-[92vh] w-full max-w-md animate-fade-up overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 shadow-float sm:rounded-3xl sm:p-6">
        <div className="mb-5 flex items-start justify-between">
          <h2 id="booking-title" className="text-lg font-extrabold">
            {t('booking.title')}
          </h2>
          <button onClick={onClose} className="-mr-2 -mt-1 rounded-lg p-2 text-muted hover:bg-subtle" aria-label={t('common.close')}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-3.5 rounded-2xl bg-subtle p-3.5">
          <Avatar name={doctor.name} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 font-bold">
              <span className="truncate">{doctor.name}</span> <BadgeCheck className="h-4 w-4 shrink-0 fill-primary text-surface" />
            </p>
            <p className="text-xs text-muted">{specialtyLabel(doctor.specialty, lang)}</p>
            {doctor.reviewCount > 0 && <Rating value={doctor.rating} reviews={doctor.reviewCount} compact />}
          </div>
          <div className="text-right">
            <p className="text-lg font-extrabold">{formatFee(doctor.consultationFee, doctor.currency)}</p>
            <p className="text-2xs text-muted">{t('doctors.perConsultation')}</p>
          </div>
        </div>

        <SlotPicker doctor={doctor} value={slot} onChange={setSlot} className="mt-5" />

        <div className="mt-5 flex items-center gap-2 rounded-xl border border-dashed border-primary/40 bg-primary-soft/50 px-3.5 py-2.5 text-xs font-semibold text-primary">
          <Video className="h-4 w-4" /> {minutes ? t('booking.videoNoteMinutes', { n: minutes }) : t('booking.videoNoteShort')}
        </div>

        <Button
          className="mt-5 w-full"
          size="lg"
          disabled={!slot || busy}
          onClick={() => reserve(slot)}
        >
          {slot ? t('booking.confirm', { time: formatDateTime(slot.startAtUtc, browserTimeZone(), locale) }) : t('booking.chooseSlot')}
        </Button>
      </div>
    </div>
  );
}
