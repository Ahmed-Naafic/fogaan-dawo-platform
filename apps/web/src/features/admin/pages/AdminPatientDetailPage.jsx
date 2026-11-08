import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Ban, FileClock, Info, RotateCcw } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { AppointmentStatusBadge } from '@/features/appointments/components/AppointmentParts';
import { formatMoney, useLoad } from '@/features/finance/financeUi';
import { useI18n } from '@/lib/i18n';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import PatientStatusDialog from '../components/PatientStatusDialog';
import { adminConsoleErrorKey } from '../services/adminConsoleApi';
import * as api from '../services/adminConsoleApi';
import { ACCOUNT_TONE } from './AdminPatientsPage';

function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-medium text-muted">{label}</dt>
      <dd className="break-words text-sm font-semibold text-ink">{children}</dd>
    </div>
  );
}

/** Admin › Patients › one patient: account facts, suspend/reactivate, appointments and payments. */
export default function AdminPatientDetailPage() {
  const { patientId } = useParams();
  const { t, locale } = useI18n();
  const tz = browserTimeZone();
  const notify = useToast();
  const state = useLoad(() => api.getPatient(patientId), [patientId]);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const fmt = (d) => (d ? formatDateTime(d, tz, locale) : '—');

  if (state.loading && !state.data) {
    return (
      <>
        <PageHeader title={t('adminPatients.title')} back="/admin/patients" />
        <div className="card h-48 animate-pulse" aria-busy="true" />
      </>
    );
  }
  if (state.error) {
    return (
      <>
        <PageHeader title={t('adminPatients.title')} back="/admin/patients" />
        <div className="card p-6 text-sm text-danger" role="alert">
          {t(adminConsoleErrorKey(state.error))}
        </div>
      </>
    );
  }
  const { patient, appointments, payments } = state.data;

  const confirm = async (reason) => {
    setBusy(true);
    try {
      if (dialog === 'suspend') {
        await api.suspendPatient(patient.patientId, reason);
        notify(t('adminPatients.suspended', { name: patient.name }), 'success');
      } else {
        await api.reactivatePatient(patient.patientId, reason);
        notify(t('adminPatients.reactivated', { name: patient.name }), 'success');
      }
      setDialog(null);
      state.reload();
    } catch (error) {
      notify(t(adminConsoleErrorKey(error)), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={patient.name} subtitle={t('adminPatients.detailSubtitle')} back="/admin/patients" />
      <p className="mb-4 flex items-start gap-2 rounded-xl border border-line bg-subtle px-4 py-3 text-xs text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0" /> {t('adminPatients.privacyNote')}
      </p>
      <Card className="p-5" data-admin-patient-detail>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <Avatar name={patient.name} size="xl" className="ring-2 ring-primary-soft" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-lg font-bold">
              {patient.name}
              <Badge tone={ACCOUNT_TONE[patient.status] ?? 'neutral'}>{t(`accountStatus.${patient.status}`)}</Badge>
              {patient.isDoctor && <Badge tone="blue">{t('roles.doctor')}</Badge>}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Fact label={t('adminPatients.email')}>{patient.email ?? '—'}</Fact>
              <Fact label={t('adminPatients.phone')}>{patient.phone ?? '—'}</Fact>
              <Fact label={t('adminPatients.language')}>{t(`languageNames.${patient.preferredLanguage}`)}</Fact>
              <Fact label={t('adminPatients.joined')}>{fmt(patient.registeredAt)}</Fact>
              <Fact label={t('adminPatients.lastLogin')}>{fmt(patient.lastLoginAt)}</Fact>
              <Fact label={t('adminPatients.totalPaid')}>{formatMoney(patient.totalPaid)}</Fact>
            </dl>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
            {patient.canSuspend && (
              <Button variant="danger" size="sm" onClick={() => setDialog('suspend')}>
                <Ban className="h-3.5 w-3.5" /> {t('adminPatients.suspend')}
              </Button>
            )}
            {patient.status === 'SUSPENDED' && (
              <Button size="sm" onClick={() => setDialog('reactivate')}>
                <RotateCcw className="h-3.5 w-3.5" /> {t('adminPatients.reactivate')}
              </Button>
            )}
            <Button variant="secondary" size="sm" to={`/admin/audit-logs?actorUserId=${patient.userId}&preset=all`}>
              <FileClock className="h-3.5 w-3.5" /> {t('adminPatients.activity')}
            </Button>
          </div>
        </div>
        {patient.status === 'ACTIVE' && patient.suspendBlocker && (
          <p className="mt-4 text-xs text-muted" role="note">
            {t(`adminPatients.blocker.${patient.suspendBlocker}`)}
          </p>
        )}
        {patient.suspension && (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200" role="note">
            <span className="font-bold">{t('adminDoctors.suspendedBy', { name: patient.suspension.by ?? '—', date: fmt(patient.suspension.at) })}</span>
            {patient.suspension.reason && <span className="mt-0.5 block">“{patient.suspension.reason}”</span>}
          </p>
        )}
      </Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-3 text-base font-bold">{t('adminPatients.appointmentsTitle', { count: patient.appointments })}</h3>
          {appointments.length === 0 ? (
            <p className="text-sm text-muted">{t('adminPatients.noAppointments')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {appointments.map((a) => (
                <li key={a.id}>
                  <Link to={`/admin/appointments/${a.id}`} className="flex items-center gap-3 py-2.5 text-sm hover:text-primary">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{a.doctor.name}</p>
                      <p className="text-xs text-muted">{fmt(a.startAtUtc)}</p>
                    </div>
                    <span className="text-xs text-muted">{formatMoney(a.fee)}</span>
                    <AppointmentStatusBadge status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <h3 className="mb-3 text-base font-bold">{t('adminPatients.paymentsTitle')}</h3>
          {payments.length === 0 ? (
            <p className="text-sm text-muted">{t('adminPatients.noPayments')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{formatMoney(p.amount)}</p>
                    <p className="text-xs text-muted">
                      {fmt(p.paidAt ?? p.createdAt)} · {p.provider}
                      {Number(p.refunded) > 0 && ` · ${t('adminPatients.refunded', { amount: formatMoney(p.refunded) })}`}
                    </p>
                  </div>
                  <Badge tone={p.status === 'SUCCEEDED' ? 'green' : p.status === 'FAILED' ? 'red' : 'neutral'}>{t(`paymentStatus.${p.status}`)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {dialog && <PatientStatusDialog mode={dialog} patient={patient} busy={busy} onCancel={() => setDialog(null)} onConfirm={confirm} />}
    </>
  );
}
