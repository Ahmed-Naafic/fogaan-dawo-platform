import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n';
import { requestNoShowRefund } from '../services/appointmentApi';

/**
 * Requirement 6: if the doctor has not admitted the patient 15 minutes after the start, the patient can
 * request a full refund. `action` is the server's `actions.noShowRefund` ({ allowed, blocker, availableAt }).
 * Shown once allowed (or as soon as `availableAt` passes while the page is open); the server re-checks
 * every rule. Two-step confirmation, then `onDone(result)`.
 */
export default function NoShowRefundButton({ appointmentId, action, onDone, className }) {
  const { t } = useI18n();
  const notify = useToast();
  const [ready, setReady] = useState(Boolean(action?.allowed));
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReady(Boolean(action?.allowed));
    if (action?.allowed || action?.blocker !== 'TOO_EARLY' || !action.availableAt) return undefined;
    const wait = Date.parse(action.availableAt) - Date.now();
    if (wait > 24 * 3_600_000) return undefined;
    const id = setTimeout(() => setReady(true), Math.max(0, wait) + 1000);
    return () => clearTimeout(id);
  }, [action]);

  if (!ready) return null;

  const submit = async () => {
    if (!confirming) return setConfirming(true);
    setBusy(true);
    try {
      const result = await requestNoShowRefund(appointmentId);
      notify(t('appointments.noShowRefund.done', { amount: `$${result.refund.amount}` }), 'success');
      onDone?.(result);
    } catch (error) {
      notify(t(error?.code === 'NO_SHOW_REFUND_NOT_ALLOWED' ? 'appointments.noShowRefund.notAllowed' : 'appointments.noShowRefund.failed'), 'error');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className={className} data-no-show-refund>
      <p className="mb-2 text-xs text-muted">{t('appointments.noShowRefund.explain')}</p>
      <Button variant={confirming ? 'primary' : 'secondary'} onClick={submit} disabled={busy}>
        <RotateCcw className="h-4 w-4" /> {t(confirming ? 'appointments.noShowRefund.confirm' : 'appointments.noShowRefund.button')}
      </Button>
    </div>
  );
}
