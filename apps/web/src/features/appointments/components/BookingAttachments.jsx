import { useState } from 'react';
import { Paperclip } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n';
import DocumentsPanel from '@/features/prescriptions/components/DocumentsPanel';
import { ensureConsultationRecord } from '../services/appointmentApi';

/**
 * Requirement 5: while booking, the patient may attach files such as lab results (PDF or image). The
 * appointment's consultation record is created on first use; the doctor sees the files once the booking
 * is paid. `consultationId` is the existing record, if any.
 */
export default function BookingAttachments({ appointmentId, consultationId: existing, onCreated, compact = false }) {
  const { t } = useI18n();
  const notify = useToast();
  const [consultationId, setConsultationId] = useState(existing ?? null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const r = await ensureConsultationRecord(appointmentId);
      setConsultationId(r.consultationId);
      onCreated?.(r.consultationId);
    } catch {
      notify(t('bookingFiles.failed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const body = consultationId ? (
    <DocumentsPanel consultationId={consultationId} compact />
  ) : (
    <div className="flex flex-col items-start gap-3">
      <p className="text-sm text-muted">{t('bookingFiles.body')}</p>
      <Button variant="secondary" onClick={start} disabled={busy} data-attach-files>
        <Paperclip className="h-4 w-4" /> {t('bookingFiles.button')}
      </Button>
    </div>
  );
  if (compact) return <div data-booking-attachments>{body}</div>;
  return (
    <Card className="p-5 sm:p-6" data-booking-attachments>
      <CardHeader title={t('bookingFiles.title')} subtitle={t('bookingFiles.subtitle')} />
      {body}
    </Card>
  );
}
