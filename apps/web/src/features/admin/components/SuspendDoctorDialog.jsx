import { useEffect, useState } from 'react';
import { Ban, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { MAX_REASON, validateSuspensionReason } from '../doctorAdmin';

/** Confirmation dialog for suspending a doctor: explains the consequences and requires a reason. */
export default function SuspendDoctorDialog({ doctor, onCancel, onConfirm, busy }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && !busy && onCancel();
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
    };
  }, [onCancel, busy]);

  const submit = (e) => {
    e.preventDefault();
    const found = validateSuspensionReason(reason);
    setError(found);
    if (!found) onConfirm(reason.trim());
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="suspend-title">
      <button aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onCancel()} />
      <form onSubmit={submit} noValidate className="relative w-full max-w-md animate-fade-up rounded-t-3xl border border-line bg-surface p-5 shadow-float sm:rounded-3xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id="suspend-title" className="text-lg font-extrabold">
            {t('adminDoctors.suspendTitle', { name: doctor.name })}
          </h2>
          <button type="button" onClick={onCancel} disabled={busy} className="-mr-2 -mt-1 rounded-lg p-2 text-muted hover:bg-subtle" aria-label={t('common.close')}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-muted">
          <li>{t('adminDoctors.consequence.access')}</li>
          <li>{t('adminDoctors.consequence.search')}</li>
          <li>{t('adminDoctors.consequence.appointments')}</li>
        </ul>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink">{t('adminDoctors.reasonLabel')}</span>
          <Textarea
            id="suspend-reason"
            rows={4}
            maxLength={MAX_REASON}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError(validateSuspensionReason(e.target.value));
            }}
            placeholder={t('adminDoctors.reasonPlaceholder')}
            aria-invalid={!!error}
            className={cn(error && 'border-danger/70')}
          />
          {error ? <p className="mt-1.5 text-2xs font-medium text-danger">{t(error)}</p> : <p className="mt-1.5 text-2xs text-muted">{t('adminDoctors.reasonHint')}</p>}
        </label>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="danger" disabled={busy}>
            <Ban className="h-4 w-4" /> {busy ? t('auth.pleaseWait') : t('adminDoctors.confirmSuspend')}
          </Button>
        </div>
      </form>
    </div>
  );
}
