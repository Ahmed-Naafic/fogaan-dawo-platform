import { useParams } from 'react-router';
import { CalendarClock, History, Lock } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Avatar from '@/components/ui/Avatar';
import Card from '@/components/ui/Card';
import { AppointmentRowCompact } from '@/features/appointments/components/AppointmentParts';
import { useLoad } from '@/features/finance/financeUi';
import PatientInformationPanel from '@/features/profile/components/PatientInformationPanel';
import usePrivateImage from '@/features/profile/usePrivateImage';
import { useI18n } from '@/lib/i18n';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import * as api from '../services/doctorWorkspaceApi';

/**
 * /doctor/patients/:patientId — one of the doctor's patients: header, the read-only Patient Information
 * panel (authorised by the newest eligible appointment; audited by the API) and every appointment the
 * two have had.
 */
export default function DoctorPatientDetailPage() {
  const { patientId } = useParams();
  const { t, locale } = useI18n();
  const tz = browserTimeZone();
  const state = useLoad(() => api.getMyPatient(patientId), [patientId]);
  const patient = state.data?.patient;
  const photo = usePrivateImage(patient?.photoUrl ?? null);

  if (state.loading && !state.data) {
    return (
      <>
        <PageHeader title={t('myPatients.title')} back="/doctor/patients" />
        <div className="card h-40 animate-pulse" aria-busy="true" />
      </>
    );
  }
  if (state.error) {
    return (
      <>
        <PageHeader title={t('myPatients.title')} back="/doctor/patients" />
        <div className="card flex items-start gap-2 p-6 text-sm text-muted" role="alert">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" /> {t(state.error.status === 403 ? 'myPatients.denied' : 'myPatients.error')}
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={patient.name} subtitle={t('myPatients.detailSubtitle')} back="/doctor/patients" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col gap-5">
          <Card className="flex items-center gap-4 p-5" data-patient-header>
            <Avatar src={photo} name={patient.name} size="xl" className="ring-2 ring-primary-soft" />
            <div className="min-w-0">
              <p className="truncate text-lg font-bold">{patient.name}</p>
              <p className="text-xs text-muted">{t('myPatients.visits', { count: patient.completedConsultations, total: patient.appointments })}</p>
              <div className="mt-1.5 flex flex-col gap-1 text-xs text-muted">
                {patient.nextVisitAt && (
                  <span className="inline-flex items-center gap-1 font-semibold text-primary">
                    <CalendarClock className="h-3.5 w-3.5" /> {t('myPatients.next', { when: formatDateTime(patient.nextVisitAt, tz, locale) })}
                  </span>
                )}
                {patient.lastVisitAt && (
                  <span className="inline-flex items-center gap-1">
                    <History className="h-3.5 w-3.5" /> {t('myPatients.last', { when: formatDateTime(patient.lastVisitAt, tz, locale) })}
                  </span>
                )}
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <h3 className="mb-3 text-base font-bold">{t('myPatients.appointmentsTitle')}</h3>
            <ul className="flex flex-col gap-2" aria-label={t('myPatients.appointmentsTitle')}>
              {state.data.appointments.map((a) => (
                <li key={a.id}>
                  <AppointmentRowCompact item={a} href={`/doctor/appointments/${a.id}`} />
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <Card className="p-5">
          <PatientInformationPanel patientId={patient.id} appointmentId={patient.appointmentId} status={patient.appointmentStatus} />
        </Card>
      </div>
    </>
  );
}
