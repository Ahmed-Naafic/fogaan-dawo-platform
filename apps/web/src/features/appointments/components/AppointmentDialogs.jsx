import { useEffect, useState } from 'react';
import { Ban, CalendarClock, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import { ratePercent } from '../booking';
import SlotPicker from './SlotPicker';

export function Dialog({ title, onClose, busy, children, labelledBy }) {
  const { t } = useI18n();
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
    };
  }, [onClose, busy]);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <button aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onClose()} />
      <div className="relative max-h-[92vh] w-full max-w-md animate-fade-up overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 shadow-float sm:rounded-3xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={labelledBy} className="text-lg font-extrabold">
            {title}
          </h2>
          <button type="button" onClick={onClose} disabled={busy} className="-mr-2 -mt-1 rounded-lg p-2 text-muted hover:bg-subtle" aria-label={t('common.close')}>
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Cancel: shows exactly what the approved policy refunds (computed by the server), reason optional for patients, required for doctors. */
export function CancelDialog({ appointment, viewer, busy, onClose, onConfirm }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const preview = appointment.actions.cancel;
  const paid = appointment.payment?.status === 'SUCCEEDED';
  const requireReason = viewer === 'DOCTOR';
  const submit = (e) => {
    e.preventDefault();
    if (requireReason && reason.trim().length < 10) return setError('appointments.errors.reasonShort');
    return onConfirm(reason.trim());
  };
  return (
    <Dialog title={t(appointment.status === 'PENDING_PAYMENT' ? 'appointments.cancelHoldTitle' : 'appointments.cancelTitle')} onClose={onClose} busy={busy} labelledBy="cancel-title">
      <form onSubmit={submit} noValidate>
        <div className="rounded-xl bg-subtle p-3.5 text-sm" data-refund-preview>
          {!paid ? (
            <p className="text-muted">{t('appointments.refund.none')}</p>
          ) : (
            <p>
              <span className="font-bold text-ink">{t('appointments.refund.amount', { amount: `$${preview.amount}`, percent: ratePercent(preview.rate) })}</span>
              <span className="mt-1 block text-xs text-muted">{t(viewer === 'DOCTOR' ? 'appointments.refund.doctorRule' : 'appointments.refund.rules', { full: appointment.policy?.fullRefundMinHours ?? 24, partial: appointment.policy?.partialRefundMinHours ?? 2 })}</span>
            </p>
          )}
        </div>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs font-semibold text-ink">{t(requireReason ? 'appointments.reasonRequired' : 'appointments.reasonOptional')}</span>
          <Textarea
            id="cancel-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            aria-invalid={!!error}
            className={cn(error && 'border-danger/70')}
          />
          {error && <p className="mt-1.5 text-2xs font-medium text-danger">{t(error)}</p>}
        </label>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('appointments.keep')}
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            <Ban className="h-4 w-4" /> {busy ? t('auth.pleaseWait') : t('appointments.confirmCancel')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Free reschedule: pick a new open time with the same doctor; the server creates the linked appointment. */
export function RescheduleDialog({ appointment, busy, onClose, onConfirm }) {
  const { t, locale } = useI18n();
  const [slot, setSlot] = useState(null);
  return (
    <Dialog title={t('appointments.rescheduleTitle')} onClose={onClose} busy={busy} labelledBy="reschedule-title">
      <p className="mb-4 text-sm text-muted">{t('appointments.rescheduleBody')}</p>
      <SlotPicker doctor={appointment.doctor} value={slot} onChange={setSlot} />
      <Button className="mt-5 w-full" size="lg" disabled={!slot || busy} onClick={() => onConfirm(slot)}>
        <CalendarClock className="h-4 w-4" /> {slot ? t('appointments.rescheduleTo', { time: formatDateTime(slot.startAtUtc, browserTimeZone(), locale) }) : t('booking.chooseSlot')}
      </Button>
    </Dialog>
  );
}
