import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CalendarX2 } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Button from '@/components/ui/Button';
import Tabs from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n';
import { bookingErrorKey } from '../booking';
import { AppointmentRow } from '../components/AppointmentParts';
import * as api from '../services/appointmentApi';

/** My Appointments (patient) and Appointments (doctor): Upcoming / Past tabs with appointment cards. */
export default function AppointmentsListPage({ viewer = 'PATIENT' }) {
  const { t } = useI18n();
  const notify = useToast();
  const [params, setParams] = useSearchParams();
  const scope = params.get('scope') === 'past' ? 'past' : 'upcoming';
  const [items, setItems] = useState(null);
  const isPatient = viewer === 'PATIENT';
  const base = isPatient ? '/patient/appointments' : '/doctor/appointments';

  useEffect(() => {
    let live = true;
    setItems(null);
    (isPatient ? api.listMyAppointments(scope) : api.listDoctorAppointments(scope))
      .then((d) => live && setItems(d))
      .catch((error) => live && (setItems([]), notify(t(bookingErrorKey(error)), 'error')));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per tab
  }, [scope, isPatient]);

  return (
    <>
      <PageHeader title={t(isPatient ? 'appointments.titlePatient' : 'appointments.titleDoctor')} subtitle={t(isPatient ? 'appointments.subtitlePatient' : 'appointments.subtitleDoctor')} back={isPatient ? '/patient' : '/doctor'} />
      <Tabs
        className="mb-5 max-w-sm"
        value={scope}
        onChange={(v) => setParams(v === 'upcoming' ? {} : { scope: v }, { replace: true })}
        items={[
          { value: 'upcoming', label: t('appointments.upcoming') },
          { value: 'past', label: t('appointments.past') },
        ]}
      />
      {!items ? (
        <div className="grid gap-3 lg:grid-cols-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-[92px] animate-pulse" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <CalendarX2 className="h-7 w-7" />
          </span>
          <p className="mt-4 text-sm text-muted">{t(`appointments.empty.${scope}${isPatient ? '' : 'Doctor'}`)}</p>
          {isPatient && scope === 'upcoming' && (
            <Button to="/patient/doctors" className="mt-5">
              {t('appointments.findDoctor')}
            </Button>
          )}
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2" aria-label={t(isPatient ? 'appointments.titlePatient' : 'appointments.titleDoctor')}>
          {items.map((item) => (
            <li key={item.id}>
              <AppointmentRow item={item} viewer={viewer} href={`${base}/${item.id}`} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
