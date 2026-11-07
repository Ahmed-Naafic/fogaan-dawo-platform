import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Download, Receipt } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { AppointmentWhen } from '@/features/appointments/components/AppointmentParts';
import { formatFee } from '@/features/doctors/doctorDirectory';
import { useI18n } from '@/lib/i18n';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import { PAYMENT_TONE, paymentErrorKey, PROVIDERS, REFUND_TONE, saveBlob } from '../paymentUi';
import * as api from '../services/paymentApi';
import { DemoBanner } from './CheckoutPage';

/** /patient/payments — the patient's simulated payments, refunds and demo receipts. */
export default function PaymentHistoryPage() {
  const { t, locale } = useI18n();
  const notify = useToast();
  const [items, setItems] = useState(null);

  useEffect(() => {
    api
      .listMyPayments()
      .then(setItems)
      .catch((error) => (setItems([]), notify(t(paymentErrorKey(error)), 'error')));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
  }, []);

  const receipt = async (p) => {
    try {
      saveBlob(await api.downloadMyReceipt(p.id), `fogaan-dawo-demo-receipt-${p.reference}.pdf`);
    } catch (error) {
      notify(t(paymentErrorKey(error)), 'error');
    }
  };

  return (
    <>
      <PageHeader title={t('payments.historyTitle')} subtitle={t('payments.historySubtitle')} back="/patient" />
      <DemoBanner className="mb-5" />
      {!items ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="card h-28 animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Receipt className="h-7 w-7" />
          </span>
          <p className="mt-4 text-sm text-muted">{t('payments.noPayments')}</p>
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2" aria-label={t('payments.historyTitle')}>
          {items.map((p) => (
            <li key={p.id} className="card p-4 sm:p-5" data-payment={p.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold">{p.appointment.doctor.name}</p>
                  <AppointmentWhen startAtUtc={p.appointment.startAtUtc} endAtUtc={p.appointment.endAtUtc} className="mt-1 text-xs text-muted" />
                </div>
                <div className="text-right">
                  <p className="text-lg font-extrabold">{formatFee(p.amount, p.currency)}</p>
                  <Badge tone={PAYMENT_TONE[p.status] ?? 'neutral'}>{t(`paymentStatus.${p.status}`)}</Badge>
                </div>
              </div>
              <p className="mt-3 text-xs text-muted">
                {PROVIDERS.find((x) => x.code === p.provider)?.name} · {t('payments.attemptsCount', { count: p.attempts.length })}
                {p.paidAt ? ` · ${formatDateTime(p.paidAt, browserTimeZone(), locale)}` : ''}
              </p>
              {p.reference && <p className="mt-1 font-mono text-2xs text-muted">{p.reference}</p>}
              {p.refunds.map((r) => (
                <p key={r.id} className="mt-2 flex items-center gap-2 text-xs">
                  <Badge tone={REFUND_TONE[r.status] ?? 'neutral'}>{t(`refundStatus.${r.status}`)}</Badge> {formatFee(r.amount, r.currency)}
                </p>
              ))}
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button to={`/patient/appointments/${p.appointment.id}`} variant="secondary" size="sm">
                  {t('payments.viewAppointment')}
                </Button>
                {p.status === 'SUCCEEDED' && (
                  <Button size="sm" variant="soft" onClick={() => receipt(p)}>
                    <Download className="h-3.5 w-3.5" /> {t('payments.receipt')}
                  </Button>
                )}
                {p.status !== 'SUCCEEDED' && p.appointment.status === 'PENDING_PAYMENT' && (
                  <Button size="sm" to={`/patient/appointments/${p.appointment.id}/pay`}>
                    {t('payments.tryAgain')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-center text-2xs text-muted">
        <Link to="/patient/appointments" className="text-primary hover:underline">
          {t('appointments.titlePatient')}
        </Link>
      </p>
    </>
  );
}
