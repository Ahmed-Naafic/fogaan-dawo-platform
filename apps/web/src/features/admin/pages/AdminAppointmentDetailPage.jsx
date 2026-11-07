import { Link, useParams } from 'react-router';
import { ArrowRight } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { AppointmentStatusBadge } from '@/features/appointments/components/AppointmentParts';
import { specialtyName } from '@/features/doctors/doctorApplicationForm';
import { formatMoney, formatRate, useLoad } from '@/features/finance/financeUi';
import { useI18n } from '@/lib/i18n';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import { adminConsoleErrorKey } from '../services/adminConsoleApi';
import * as api from '../services/adminConsoleApi';

function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-medium text-muted">{label}</dt>
      <dd className="break-words text-sm font-semibold text-ink">{children}</dd>
    </div>
  );
}

/** Admin › Appointments › one appointment: people, timing, status history, payment, refunds, consultation. */
export default function AdminAppointmentDetailPage() {
  const { appointmentId } = useParams();
  const { t, lang, locale } = useI18n();
  const tz = browserTimeZone();
  const state = useLoad(() => api.getAppointment(appointmentId), [appointmentId]);
  const fmt = (d) => (d ? formatDateTime(d, tz, locale) : '—');

  if (state.loading && !state.data) {
    return (
      <>
        <PageHeader title={t('adminAppointments.title')} back="/admin/appointments" />
        <div className="card h-48 animate-pulse" aria-busy="true" />
      </>
    );
  }
  if (state.error) {
    return (
      <>
        <PageHeader title={t('adminAppointments.title')} back="/admin/appointments" />
        <div className="card p-6 text-sm text-danger" role="alert">
          {t(adminConsoleErrorKey(state.error))}
        </div>
      </>
    );
  }
  const a = state.data;

  return (
    <>
      <PageHeader title={t('adminAppointments.detailTitle')} subtitle={fmt(a.startAtUtc)} back="/admin/appointments" />
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="p-5" data-admin-appointment-detail>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <AppointmentStatusBadge status={a.status} />
            {a.rescheduled && <Badge tone="purple">{t('appointments.rescheduledBadge')}</Badge>}
            {a.bookingType !== 'STANDARD' && <Badge tone="blue">{t('adminAppointments.followUp')}</Badge>}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label={t('adminAppointments.col.patient')}>
              <Link to={`/admin/patients/${a.patient.id}`} className="hover:text-primary">
                {a.patient.name}
              </Link>
            </Fact>
            <Fact label={t('adminAppointments.col.doctor')}>
              {a.doctor.name}
              <span className="block text-2xs font-normal text-muted">{specialtyName(a.doctor.specialty, lang)}</span>
            </Fact>
            <Fact label={t('adminAppointments.start')}>{fmt(a.startAtUtc)}</Fact>
            <Fact label={t('adminAppointments.end')}>{fmt(a.endAtUtc)}</Fact>
            <Fact label={t('adminAppointments.bookedAt')}>{fmt(a.bookedAt)}</Fact>
            <Fact label={t('adminAppointments.col.fee')}>
              {formatMoney(a.fee)} <span className="text-2xs font-normal text-muted">({t('adminAppointments.commission', { rate: formatRate(a.commissionRate) })})</span>
            </Fact>
            {a.cancelledAt && <Fact label={t('adminAppointments.cancelledAt')}>{fmt(a.cancelledAt)}</Fact>}
            {a.cancellationReason && <Fact label={t('adminAppointments.cancellationReason')}>{a.cancellationReason}</Fact>}
            {a.consultation && (
              <Fact label={t('adminAppointments.consultation')}>
                {t(`consultStatus.${a.consultation.status}`)}
                <span className="block text-2xs font-normal text-muted">
                  {a.consultation.startedAt ? `${fmt(a.consultation.startedAt)} → ${fmt(a.consultation.endedAt)}` : t('adminAppointments.notStarted')}
                </span>
              </Fact>
            )}
          </dl>
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-base font-bold">{t('adminAppointments.historyTitle')}</h3>
          <ol className="space-y-2.5">
            {a.statusHistory.map((h, i) => (
              <li key={i} className="text-sm">
                <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                  {h.from && (
                    <>
                      {t(`apptStatus.${h.from}`)} <ArrowRight className="h-3.5 w-3.5 text-muted" />
                    </>
                  )}
                  {t(`apptStatus.${h.to}`)}
                </p>
                <p className="text-xs text-muted">
                  {fmt(h.at)}
                  {h.by && ` · ${h.by}`}
                  {h.reason && ` · ${h.reason}`}
                </p>
              </li>
            ))}
          </ol>
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-base font-bold">{t('adminAppointments.paymentTitle')}</h3>
          {!a.payment ? (
            <p className="text-sm text-muted">{t('adminAppointments.noPayment')}</p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label={t('adminAppointments.amount')}>{formatMoney(a.payment.amount)}</Fact>
              <Fact label={t('adminAppointments.status')}>{t(`paymentStatus.${a.payment.status}`)}</Fact>
              <Fact label={t('adminAppointments.provider')}>{a.payment.provider}</Fact>
              <Fact label={t('adminAppointments.paidAt')}>{fmt(a.payment.paidAt)}</Fact>
              {a.earning && (
                <>
                  <Fact label={t('adminAppointments.doctorShare')}>{formatMoney(a.earning.net)}</Fact>
                  <Fact label={t('adminAppointments.platformShare')}>{formatMoney(a.earning.commission)}</Fact>
                </>
              )}
            </dl>
          )}
          {a.payment && (
            <Link to={`/admin/finance/payments?preset=all&q=${a.payment.id}`} className="mt-3 inline-block text-xs font-semibold text-primary hover:underline">
              {t('adminAppointments.openInFinance')}
            </Link>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-base font-bold">{t('adminAppointments.refundsTitle')}</h3>
          {a.refunds.length === 0 ? (
            <p className="text-sm text-muted">{t('adminAppointments.noRefunds')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {a.refunds.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <p className="font-semibold">{formatMoney(r.amount)}</p>
                    <p className="text-xs text-muted">{fmt(r.processedAt ?? r.requestedAt)}</p>
                  </div>
                  <Link to={`/admin/finance/refunds?preset=all&q=${r.id}`} className="hover:opacity-80">
                    <Badge tone={r.status === 'SUCCEEDED' ? 'green' : r.status === 'REJECTED' || r.status === 'FAILED' ? 'red' : 'gold'}>{t(`refundStatus.${r.status}`)}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
