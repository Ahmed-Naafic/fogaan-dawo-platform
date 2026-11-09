import { useCallback, useEffect, useRef, useState } from 'react';
import BookingAttachments from '@/features/appointments/components/BookingAttachments';
import { Link, useParams } from 'react-router';
import { CheckCircle2, CircleAlert, Download, FlaskConical, Hourglass, Loader2, RefreshCw, Smartphone, TimerOff, Wallet } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { AppointmentWhen, HoldCountdown } from '@/features/appointments/components/AppointmentParts';
import { formatFee, specialtyLabel } from '@/features/doctors/doctorDirectory';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { newAttemptKey, normaliseWallet, paymentErrorKey, PROVIDERS, saveBlob } from '../paymentUi';
import * as api from '../services/paymentApi';

const POLL_MS = 4000;

/** DEMO banner shown on every payment screen. */
export function DemoBanner({ className }) {
  const { t } = useI18n();
  return (
    <p className={cn('flex items-start gap-2 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-800 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-200', className)} role="note">
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" /> {t('payments.demoBanner')}
    </p>
  );
}

function ResultPanel({ outcome, payment, appointmentId, onRetry, onCheck, checking }) {
  const { t, lang } = useI18n();
  const notify = useToast();
  const receipt = async () => {
    try {
      saveBlob(await api.downloadMyReceipt(payment.id, lang), `fogaan-dawo-demo-receipt-${payment.reference}.pdf`);
    } catch (error) {
      notify(t(paymentErrorKey(error)), 'error');
    }
  };
  const view = {
    SUCCESS: [CheckCircle2, 'text-success', 'payments.result.success'],
    FAILED: [CircleAlert, 'text-danger', 'payments.result.failed'],
    PENDING: [Hourglass, 'text-amber-600 dark:text-amber-300', 'payments.result.pending'],
    EXPIRED: [TimerOff, 'text-muted', 'payments.result.expired'],
  }[outcome];
  const [Icon, tone, key] = view;
  return (
    <div className="flex flex-col items-center py-4 text-center" data-outcome={outcome} aria-live="polite">
      <Icon className={cn('h-14 w-14', tone, outcome === 'PENDING' && 'animate-pulse')} />
      <p className="mt-3 text-lg font-extrabold">{t(`${key}.title`)}</p>
      <p className="mt-1 max-w-sm text-sm text-muted">{t(`${key}.body`)}</p>
      {payment?.lastMessage && outcome !== 'SUCCESS' && <p className="mt-2 text-xs text-muted">{payment.lastMessage}</p>}
      {payment?.reference && (
        <p className="mt-3 rounded-lg bg-subtle px-3 py-1.5 font-mono text-xs" data-reference>
          {t('payments.reference')}: {payment.reference}
        </p>
      )}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {outcome === 'SUCCESS' && (
          <>
            <Button variant="secondary" onClick={receipt}>
              <Download className="h-4 w-4" /> {t('payments.downloadReceipt')}
            </Button>
            <Button to={`/patient/appointments/${appointmentId}`}>{t('payments.viewAppointment')}</Button>
          </>
        )}
        {outcome === 'FAILED' && <Button to="/patient/doctors">{t('payments.findAnotherTime')}</Button>}
        {outcome === 'PENDING' && (
          <Button variant="secondary" onClick={onCheck} disabled={checking}>
            <RefreshCw className={cn('h-4 w-4', checking && 'animate-spin')} /> {t('payments.checkStatus')}
          </Button>
        )}
        {outcome === 'EXPIRED' && <Button to="/patient/doctors">{t('payments.findAnotherTime')}</Button>}
      </div>
    </div>
  );
}

/** /patient/appointments/:id/pay — simulated checkout for a reservation. */
export default function CheckoutPage() {
  const { appointmentId } = useParams();
  const { t, lang } = useI18n();
  const notify = useToast();
  const [data, setData] = useState(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [missing, setMissing] = useState(false);
  const [provider, setProvider] = useState('EVC_PLUS');
  const [wallet, setWallet] = useState('');
  const [walletError, setWalletError] = useState(null);
  const [phase, setPhase] = useState('form'); // form | processing | result
  const [outcome, setOutcome] = useState(null);
  const [payment, setPayment] = useState(null);
  const [checking, setChecking] = useState(false);
  const attemptKey = useRef(newAttemptKey());

  const load = useCallback(() => {
    api
      .getCheckout(appointmentId)
      .then((d) => {
        setReceivedAt(Date.now());
        setData(d);
        setPayment(d.payment);
        const s = d.appointment.status;
        if (s === 'CONFIRMED' || d.payment?.status === 'SUCCEEDED') return (setOutcome('SUCCESS'), setPhase('result'));
        if (s === 'EXPIRED') return (setOutcome('EXPIRED'), setPhase('result'));
        if (d.payment?.lastOutcome === 'PENDING' && d.payment.status === 'PENDING') return (setOutcome('PENDING'), setPhase('result'));
        return null;
      })
      .catch(() => setMissing(true));
  }, [appointmentId]);
  useEffect(load, [load]);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const r = await api.refreshPayment(appointmentId);
      setPayment(r.payment);
      if (r.outcome !== 'PENDING' && r.outcome !== 'NONE') setOutcome(r.outcome);
    } catch (error) {
      notify(t(paymentErrorKey(error)), 'error');
    } finally {
      setChecking(false);
    }
  }, [appointmentId, notify, t]);

  // While PENDING, ask the server again every few seconds (the server asks the simulated provider).
  useEffect(() => {
    if (outcome !== 'PENDING') return undefined;
    const id = setInterval(check, POLL_MS);
    return () => clearInterval(id);
  }, [outcome, check]);

  const submit = async (e) => {
    e.preventDefault();
    const normalised = normaliseWallet(wallet);
    if (!normalised) return setWalletError('payments.walletInvalid');
    setWalletError(null);
    setPhase('processing');
    try {
      const r = await api.pay(appointmentId, { provider, wallet: normalised }, attemptKey.current);
      setPayment(r.payment);
      setOutcome(r.outcome);
      setPhase('result');
    } catch (error) {
      notify(t(paymentErrorKey(error)), 'error');
      setPhase('form');
      if (error?.code === 'PAYMENT_ALREADY_SUCCEEDED' || error?.code === 'APPOINTMENT_NOT_PAYABLE') load();
    }
    return undefined;
  };
  const retry = () => {
    attemptKey.current = newAttemptKey(); // a new attempt gets a new key
    setOutcome(null);
    setPhase('form');
  };

  if (missing) {
    return (
      <>
        <PageHeader title={t('payments.checkoutTitle')} back="/patient/appointments" />
        <Card className="p-6 text-sm text-muted">{t('appointments.notFoundBody')}</Card>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader title={t('payments.checkoutTitle')} back={`/patient/appointments/${appointmentId}`} />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]" aria-busy="true">
          <div className="card h-96 animate-pulse" />
          <div className="card h-64 animate-pulse" />
        </div>
      </>
    );
  }

  const a = data.appointment;
  const providerName = PROVIDERS.find((p) => p.code === provider)?.name;

  return (
    <>
      <PageHeader title={t('payments.checkoutTitle')} subtitle={t('payments.checkoutSubtitle')} back={`/patient/appointments/${appointmentId}`} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="p-5 sm:p-6">
          <DemoBanner className="mb-5" />
          {phase === 'processing' ? (
            <div className="flex flex-col items-center py-12 text-center" aria-live="polite" data-outcome="PROCESSING">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="mt-4 font-bold">{t('payments.processing', { provider: providerName })}</p>
              <p className="mt-1 text-sm text-muted">{t('payments.processingBody')}</p>
            </div>
          ) : phase === 'result' ? (
            <ResultPanel outcome={outcome} payment={payment} appointmentId={appointmentId} onRetry={retry} onCheck={check} checking={checking} />
          ) : (
            <form onSubmit={submit} noValidate>
              <CardHeader title={t('payments.chooseMethod')} />
              <div className="grid gap-2.5 sm:grid-cols-3" role="radiogroup" aria-label={t('payments.chooseMethod')}>
                {PROVIDERS.map((p) => (
                  <button
                    key={p.code}
                    type="button"
                    role="radio"
                    aria-checked={provider === p.code}
                    onClick={() => setProvider(p.code)}
                    data-provider={p.code}
                    className={cn('flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-colors', provider === p.code ? 'border-primary bg-primary-soft/60 ring-2 ring-primary/30' : 'border-line hover:bg-subtle')}
                  >
                    <span className={cn('flex h-10 w-10 items-center justify-center rounded-xl', provider === p.code ? 'bg-primary text-primary-fg' : 'bg-subtle text-muted')}>
                      <Wallet className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="block text-sm font-bold">{p.name}</span>
                      <span className="block text-2xs text-muted">{t('payments.mobileMoney')}</span>
                    </span>
                  </button>
                ))}
              </div>

              <label className="mt-5 block">
                <span className="mb-1.5 block text-xs font-semibold text-ink">{t('payments.walletLabel', { provider: providerName })}</span>
                <Input icon={Smartphone} name="wallet" inputMode="tel" autoComplete="tel" value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder="+252 61 555 1234" aria-invalid={!!walletError} />
                {walletError && <p className="mt-1.5 text-2xs font-medium text-danger">{t(walletError)}</p>}
              </label>

              <details className="mt-4 rounded-xl bg-subtle px-3.5 py-2.5 text-xs text-muted">
                <summary className="cursor-pointer font-semibold text-ink">{t('payments.demoNumbersTitle')}</summary>
                <ul className="mt-2 space-y-1 font-mono">
                  <li>{t('payments.demoNumbers.success')}</li>
                  <li>{data.demoWallets.failure} — {t('payments.demoNumbers.failure')}</li>
                  <li>{data.demoWallets.pending} — {t('payments.demoNumbers.pending')}</li>
                  <li>{data.demoWallets.pendingThenSuccess} — {t('payments.demoNumbers.pendingThenSuccess')}</li>
                  <li>{data.demoWallets.refundFails} — {t('payments.demoNumbers.refundFails')}</li>
                </ul>
              </details>

              <Button type="submit" size="lg" className="mt-5 w-full" disabled={a.status !== 'PENDING_PAYMENT'}>
                {t('payments.payAmount', { amount: formatFee(a.fee, a.currency) })}
              </Button>
              <p className="mt-2 text-center text-2xs text-muted">{t('payments.amountFromServer')}</p>
            </form>
          )}
        </Card>

        <div className="space-y-5">
          {a.status === 'PENDING_PAYMENT' && phase !== 'result' && <HoldCountdown holdExpiresAt={a.holdExpiresAt} serverTime={data.serverTime} receivedAt={receivedAt} onExpire={load} />}
          {a.status === 'PENDING_PAYMENT' && phase === 'result' && outcome === 'PENDING' && <HoldCountdown holdExpiresAt={a.holdExpiresAt} serverTime={data.serverTime} receivedAt={receivedAt} onExpire={outcome === 'PENDING' ? check : load} />}
          <Card className="p-5 sm:p-6">
            <CardHeader title={t('payments.summary')} />
            <p className="font-bold">{a.doctor.name}</p>
            <p className="text-sm text-muted">{specialtyLabel(a.doctor.specialty, lang)}</p>
            <AppointmentWhen startAtUtc={a.startAtUtc} endAtUtc={a.endAtUtc} className="mt-2 text-xs text-muted" />
            <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
              <span className="text-sm text-muted">{t('payments.total')}</span>
              <span className="text-xl font-extrabold">{formatFee(a.fee, a.currency)}</span>
            </div>
            <p className="mt-2 text-2xs text-muted">{t('payments.demoAmountNote')}</p>
            {a.status === 'PENDING_PAYMENT' && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="mb-2 text-sm font-bold">{t('bookingFiles.title')}</p>
                <BookingAttachments compact appointmentId={appointmentId} consultationId={a.consultation?.id} />
              </div>
            )}
            <Link to={`/patient/appointments/${appointmentId}`} className="mt-4 inline-block text-xs font-semibold text-primary hover:underline">
              {t('payments.backToAppointment')}
            </Link>
          </Card>
        </div>
      </div>
    </>
  );
}
