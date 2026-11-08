import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { proposeFollowUp } from '../services/appointmentApi';
import SlotPicker from './SlotPicker';

const FEES = ['NORMAL', 'DISCOUNTED', 'FREE'];

/**
 * Requirement 12 (doctor): after a completed consultation, book a follow-up in one of your own free
 * slots and choose the fee (normal, 50 % discount or free). The patient must confirm and pay (unless
 * free) within the follow-up deadline, or the time is released. Shown on the doctor's appointment page.
 */
export default function FollowUpCard({ consultationId, doctor, fee, onDone }) {
  const { t } = useI18n();
  const notify = useToast();
  const [slot, setSlot] = useState(null);
  const [choice, setChoice] = useState('NORMAL');
  const [busy, setBusy] = useState(false);
  const amounts = { NORMAL: Number(fee), DISCOUNTED: Math.round(Number(fee) * 50) / 100, FREE: 0 };

  const submit = async () => {
    if (!slot) return notify(t('followUp.pickSlot'), 'error');
    setBusy(true);
    try {
      const r = await proposeFollowUp(consultationId, { slotId: slot.id, fee: choice });
      notify(t('followUp.booked'), 'success');
      onDone?.(r);
    } catch (error) {
      const key = { FOLLOW_UP_EXISTS: 'followUp.errors.exists', FOLLOW_UP_SLOT_INVALID: 'followUp.errors.slot', FOLLOW_UP_NOT_ALLOWED: 'followUp.errors.notAllowed' }[error?.code];
      notify(t(key ?? 'followUp.errors.generic'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 sm:p-6" id="follow-up" data-follow-up-card>
      <CardHeader title={t('followUp.title')} subtitle={t('followUp.subtitle')} />
      <SlotPicker doctor={doctor} value={slot} onChange={setSlot} />
      <fieldset className="mt-4">
        <legend className="mb-2 text-xs font-semibold text-muted">{t('followUp.feeLabel')}</legend>
        <div className="grid grid-cols-3 gap-2">
          {FEES.map((f) => (
            <label key={f} className={cn('cursor-pointer rounded-xl border px-3 py-2.5 text-center text-xs font-semibold', choice === f ? 'border-primary bg-primary-soft text-primary' : 'border-line')}>
              <input type="radio" name="follow-up-fee" value={f} checked={choice === f} onChange={() => setChoice(f)} className="sr-only" />
              {t(`followUp.fee.${f}`)}
              <span className="mt-0.5 block font-bold">${amounts[f].toFixed(2)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 flex justify-end">
        <Button onClick={submit} disabled={busy || !slot}>
          <CalendarPlus className="h-4 w-4" /> {t('followUp.submit')}
        </Button>
      </div>
    </Card>
  );
}
