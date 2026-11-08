import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowRight, Ban, CalendarClock, CreditCard, Receipt, Video } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { formatFee, specialtyLabel } from '@/features/doctors/doctorDirectory';
import { useI18n } from '@/lib/i18n';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import { bookingErrorKey } from '../booking';
import { AppointmentStatusBadge, AppointmentWhen, HoldCountdown } from '../components/AppointmentParts';
import { CancelDialog, RescheduleDialog } from '../components/AppointmentDialogs';
import NoShowRefundButton from '../components/NoShowRefundButton';
import RatingCard from '../components/RatingCard';
import FollowUpCard from '../components/FollowUpCard';
import BookingAttachments from '../components/BookingAttachments';
import * as api from '../services/appointmentApi';
import PatientInformationPanel from '@/features/profile/components/PatientInformationPanel';
import usePrivateImage from '@/features/profile/usePrivateImage';
import ConsultationPrescriptions from '@/features/prescriptions/components/ConsultationPrescriptions';
import ConsultationSummaryCard from '@/features/prescriptions/components/ConsultationSummaryCard';
import DocumentsPanel from '@/features/prescriptions/components/DocumentsPanel';

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-semibold text-ink">{children}</dd>
    </div>
  );
}

/** One appointment — reservation countdown, details, payment/refunds, history, and the allowed actions. */
export default function AppointmentDetailPage({ viewer = 'PATIENT' }) {
  const { appointmentId } = useParams();
  const { t, lang, locale } = useI18n();
  const notify = useToast();
  const navigate = useNavigate();
  const isPatient = viewer === 'PATIENT';
  const base = isPatient ? '/patient/appointments' : '/doctor/appointments';
  const [data, setData] = useState(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [missing, setMissing] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  // Assigned doctor: the patient's photo through the gated, audited route (hook before any early return).
  const counterpartPhoto = usePrivateImage(isPatient ? null : data?.patient?.photoUrl);

  const load = useCallback(() => {
    (isPatient ? api.getMyAppointment(appointmentId) : api.getDoctorAppointment(appointmentId))
      .then((d) => {
        setReceivedAt(Date.now());
        setData(d);
      })
      .catch(() => setMissing(true));
  }, [appointmentId, isPatient]);
  useEffect(() => {
    setData(null);
    setMissing(false);
    load();
  }, [load]);

  const cancel = async (reason) => {
    setBusy(true);
    try {
      const result = await (isPatient ? api.cancelMyAppointment(appointmentId, reason) : api.cancelDoctorAppointment(appointmentId, reason));
      notify(result.refund ? t('appointments.cancelledRefund', { amount: `$${result.refund.amount}` }) : t('appointments.cancelled'));
      setDialog(null);
      setReceivedAt(Date.now());
      setData(result.appointment);
    } catch (error) {
      notify(t(bookingErrorKey(error)), 'error');
    } finally {
      setBusy(false);
    }
  };
  const reschedule = async (slot) => {
    setBusy(true);
    try {
      const moved = await api.rescheduleMyAppointment(appointmentId, slot.id);
      notify(t('appointments.rescheduled'));
      setDialog(null);
      navigate(`${base}/${moved.id}`, { replace: true });
    } catch (error) {
      notify(t(bookingErrorKey(error)), 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmFree = async () => {
    setBusy(true);
    try {
      await api.confirmFreeFollowUp(appointmentId);
      notify(t('followUp.confirmed'));
      load();
    } catch (error) {
      notify(t(bookingErrorKey(error)), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (missing) {
    return (
      <>
        <PageHeader title={t('appointments.notFound')} back={base} />
        <Card className="p-6 text-sm text-muted">{t('appointments.notFoundBody')}</Card>
      </>
    );
  }
  if (!data) {
    return (
      <>
        <PageHeader title={t('appointments.detailTitle')} back={base} />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]" aria-busy="true">
          <div className="card h-96 animate-pulse" />
          <div className="card h-64 animate-pulse" />
        </div>
      </>
    );
  }

  const pending = data.status === 'PENDING_PAYMENT';
  const counterpart = isPatient ? data.doctor : data.patient;
  const fmt = (iso) => formatDateTime(iso, browserTimeZone(), locale);

  return (
    <>
      <PageHeader title={t('appointments.detailTitle')} subtitle={t(`apptStatusHint.${data.status}`)} back={base} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          {pending && <HoldCountdown holdExpiresAt={data.holdExpiresAt} serverTime={data.serverTime} receivedAt={receivedAt} onExpire={load} />}

          <Card className="p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <Avatar src={counterpartPhoto} name={counterpart.name} size="xl" className="ring-4 ring-primary-soft" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-lg font-extrabold">
                  <span>{counterpart.name}</span>
                  <AppointmentStatusBadge status={data.status} />
                </p>
                {isPatient && <p className="text-sm text-muted">{specialtyLabel(data.doctor.specialty, lang)}</p>}
                <AppointmentWhen startAtUtc={data.startAtUtc} endAtUtc={data.endAtUtc} className="mt-2 text-sm text-ink" />
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary">
                  <Video className="h-3.5 w-3.5" /> {t('appointments.videoConsultation')}
                </p>
              </div>
            </div>

            <dl className="mt-5 divide-y divide-line border-t border-line">
              <Row label={t('appointments.fee')}>{formatFee(data.fee, data.currency)}</Row>
              {data.reason && <Row label={t('appointments.reason')}>{data.reason}</Row>}
              <Row label={t('appointments.payment')}>
                {data.payment ? t(`paymentStatus.${data.payment.status}`) : pending ? t('appointments.awaitingPayment') : '—'}
              </Row>
              {data.refunds.map((r) => (
                <Row key={r.id} label={t('appointments.refundLabel')}>
                  {`$${r.amount}`} · {t(`refundStatus.${r.status}`)}
                </Row>
              ))}
              {data.cancellationReason && <Row label={t('appointments.cancellationReason')}>{data.cancellationReason}</Row>}
              {data.followUpOf && (
                <Row label={t('followUp.ofConsultation')}>
                  <Link className="text-primary hover:underline" to={`${base}/${data.followUpOf.appointmentId}`} data-follow-up-of>
                    {fmt(data.followUpOf.startAtUtc)}
                  </Link>
                </Row>
              )}
              {pending && data.freeFollowUp && <Row label={t('appointments.payment')}>{t('followUp.free')}</Row>}
              {data.rescheduledFrom && (
                <Row label={t('appointments.rescheduledFrom')}>
                  <Link className="text-primary hover:underline" to={`${base}/${data.rescheduledFrom.id}`}>
                    {fmt(data.rescheduledFrom.startAtUtc)}
                  </Link>
                </Row>
              )}
              {data.rescheduledTo && (
                <Row label={t('appointments.rescheduledTo')}>
                  <Link className="text-primary hover:underline" to={`${base}/${data.rescheduledTo.id}`}>
                    {fmt(data.rescheduledTo.startAtUtc)}
                  </Link>
                </Row>
              )}
            </dl>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              {data.actions.join?.allowed && (
                <Button size="lg" className="sm:order-last" to={`/consultation/${data.id}`} data-join-consultation>
                  <Video className="h-4 w-4" /> {t('appointments.joinConsultation')} <ArrowRight className="h-4 w-4" />
                </Button>
              )}
              {pending && isPatient && data.freeFollowUp && (
                <Button size="lg" className="sm:order-last" disabled={busy} onClick={confirmFree} data-confirm-free>
                  {t('followUp.confirmFree')} <ArrowRight className="h-4 w-4" />
                </Button>
              )}
              {pending && isPatient && !data.freeFollowUp && (
                <Button size="lg" className="sm:order-last" to={`/patient/appointments/${data.id}/pay`}>
                  <CreditCard className="h-4 w-4" /> {t('appointments.continueToPayment')} <ArrowRight className="h-4 w-4" />
                </Button>
              )}
              {isPatient && data.payment?.status === 'SUCCEEDED' && (
                <Button variant="secondary" to="/patient/payments">
                  <Receipt className="h-4 w-4" /> {t('payments.receiptsLink')}
                </Button>
              )}
              {isPatient && data.actions.reschedule.allowed && (
                <Button variant="secondary" onClick={() => setDialog('reschedule')}>
                  <CalendarClock className="h-4 w-4" /> {t('appointments.reschedule')}
                </Button>
              )}
              {data.actions.cancel.allowed && (
                <Button variant="secondary" className="text-danger" onClick={() => setDialog('cancel')}>
                  <Ban className="h-4 w-4" /> {t(pending ? 'appointments.cancelHold' : 'appointments.cancel')}
                </Button>
              )}
            </div>
            {isPatient && data.actions.noShowRefund && (
              <NoShowRefundButton className="mt-4 text-right" appointmentId={data.id} action={data.actions.noShowRefund} onDone={() => load()} />
            )}
            {data.actions.join?.blocker === 'TOO_EARLY' && data.status === 'CONFIRMED' && (
              <p className="mt-3 text-right text-2xs text-muted" data-join-opens>
                {t('appointments.joinOpensAt', { time: fmt(data.actions.join.opensAt) })}
              </p>
            )}
            {isPatient && data.status === 'CONFIRMED' && !data.actions.reschedule.allowed && (
              <p className="mt-3 text-right text-2xs text-muted">{t(`appointments.rescheduleBlocked.${data.actions.reschedule.blocker}`, { hours: data.policy?.freeRescheduleMinHours ?? 24 })}</p>
            )}
          </Card>
          {!isPatient && data.patient?.id && (
            <Card className="p-5 sm:p-6">
              <PatientInformationPanel patientId={data.patient.id} appointmentId={data.id} status={data.status} />
            </Card>
          )}
          {!isPatient && data.status === 'COMPLETED' && data.consultation?.status === 'COMPLETED' && (
            <FollowUpCard consultationId={data.consultation.id} doctor={{ id: data.doctor.id, timeZone: data.doctor.timeZone }} fee={data.fee} onDone={(r) => navigate(`/doctor/appointments/${r.appointmentId}`)} />
          )}
          {isPatient && (data.review || data.actions.rate?.allowed) && <RatingCard appointmentId={data.id} action={data.actions.rate} review={data.review} onDone={() => load()} />}
          {isPatient && ['PENDING_PAYMENT', 'CONFIRMED'].includes(data.status) && (
            <BookingAttachments appointmentId={data.id} consultationId={data.consultation?.id} onCreated={() => load()} />
          )}
          {data.consultation?.id && ['WAITING', 'IN_PROGRESS', 'COMPLETED'].includes(data.status) && (
            <>
              <Card className="p-5 sm:p-6">
                <ConsultationSummaryCard consultationId={data.consultation.id} role={viewer} refreshKey={data.status} />
              </Card>
              <Card className="p-5 sm:p-6">
                <ConsultationPrescriptions consultationId={data.consultation.id} role={viewer} refreshKey={data.status} />
              </Card>
            </>
          )}
          {data.consultation?.id && !(isPatient && ['PENDING_PAYMENT', 'CONFIRMED'].includes(data.status)) && ['CONFIRMED', 'WAITING', 'IN_PROGRESS', 'COMPLETED'].includes(data.status) && (
            <Card className="p-5 sm:p-6">
              <DocumentsPanel consultationId={data.consultation.id} />
            </Card>
          )}
        </div>

        <Card className="p-5 sm:p-6">
          <CardHeader title={t('appointments.history')} />
          <ol className="space-y-3 border-l-2 border-line pl-4">
            {data.history.map((h, i) => (
              <li key={i} className="text-xs">
                <span className="flex items-center gap-1.5 font-semibold text-ink">
                  <Receipt className="h-3.5 w-3.5 text-primary" /> {t(`apptStatus.${h.to}`)}
                </span>
                <span className="text-muted">{fmt(h.at)}</span>
                {h.reason && <p className="mt-0.5 text-muted">{h.reason}</p>}
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {dialog === 'cancel' && <CancelDialog appointment={data} viewer={viewer} busy={busy} onClose={() => setDialog(null)} onConfirm={cancel} />}
      {dialog === 'reschedule' && <RescheduleDialog appointment={data} busy={busy} onClose={() => setDialog(null)} onConfirm={reschedule} />}
    </>
  );
}
