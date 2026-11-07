import { useCallback, useEffect, useState } from 'react';
import { HeartPulse, Info, Lock, Phone, Pill, ShieldAlert, Stethoscope, UserRound, Users } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { dateOnly, HISTORY_TYPES } from '../profileUi';
import { getPatientInformation } from '../services/profileApi';
import usePrivateImage from '../usePrivateImage';

const TYPE_ICON = { ALLERGY: ShieldAlert, CONDITION: HeartPulse, MEDICATION: Pill, SURGERY: Stethoscope, FAMILY_HISTORY: Users, OTHER: Info };

/** Appointment statuses that allow the assigned doctor to read (mirrors the API; the API decides). */
export const PATIENT_INFO_STATUSES = Object.freeze(['CONFIRMED', 'WAITING', 'IN_PROGRESS', 'COMPLETED']);

/**
 * Read-only Patient Information for the ASSIGNED doctor: restricted summary (age, sex, emergency contact
 * only during an active consultation) and the patient's medical history grouped by category, with empty
 * states. Every load is authorised and audited by the API. No address, photo, email or phone is shown
 * because the API never returns them. `refreshKey` reloads (e.g. when the consultation starts).
 */
export default function PatientInformationPanel({ patientId, appointmentId, status, compact = false, className }) {
  const { t, locale } = useI18n();
  const eligible = PATIENT_INFO_STATUSES.includes(status);
  const [state, setState] = useState({ phase: 'loading', data: null, code: null });

  const load = useCallback(() => {
    if (!eligible || !patientId || !appointmentId) return undefined;
    let live = true;
    setState((s) => ({ ...s, phase: s.data ? 'refreshing' : 'loading' }));
    getPatientInformation(patientId, appointmentId)
      .then((data) => live && setState({ phase: 'ready', data, code: null }))
      .catch((error) => live && setState({ phase: error?.status === 403 ? 'denied' : 'error', data: null, code: error?.code ?? null }));
    return () => {
      live = false;
    };
  }, [eligible, patientId, appointmentId]);

  // Reload when the appointment status changes (e.g. the doctor admits the patient → emergency contact).
  useEffect(load, [load, status]);

  // The photo is private: fetched with the doctor's session (gated + audited by the API), shown via an object URL.
  const photo = usePrivateImage(state.data?.patient?.photoUrl ?? null);

  const heading = (
    <h3 className={cn('flex items-center gap-2 font-bold', compact ? 'mb-3 text-sm' : 'mb-1 text-base sm:text-[17px]')}>
      <UserRound className="h-4 w-4 text-primary" /> {t('patientInfo.title')}
    </h3>
  );

  if (!eligible) {
    return (
      <section className={className} data-patient-info="unavailable">
        {heading}
        <p className="flex items-start gap-2 text-xs text-muted">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t('patientInfo.notEligible')}
        </p>
      </section>
    );
  }

  if (state.phase === 'loading') {
    return (
      <section className={className} aria-busy="true" data-patient-info="loading">
        {heading}
        <div className="space-y-2">
          <div className="h-12 animate-pulse rounded-xl bg-subtle" />
          <div className="h-24 animate-pulse rounded-xl bg-subtle" />
        </div>
      </section>
    );
  }
  if (state.phase === 'denied') {
    return (
      <section className={className} data-patient-info="denied" role="alert">
        {heading}
        <p className="flex items-start gap-2 text-sm text-muted">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" /> {t(state.code === 'DOCTOR_NOT_ACTIVE' ? 'patientInfo.doctorInactive' : 'patientInfo.denied')}
        </p>
      </section>
    );
  }
  if (state.phase === 'error') {
    return (
      <section className={className} data-patient-info="error" role="alert">
        {heading}
        <p className="text-sm text-muted">{t('patientInfo.loadFailed')}</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={load}>
          {t('profile.retry')}
        </Button>
      </section>
    );
  }

  const { patient, entries, appointment } = state.data;
  const byType = (type) => entries.filter((e) => e.entryType === type);
  const summary = [
    [t('patientInfo.age'), patient.age != null ? t('patientInfo.years', { count: patient.age }) : t('patientInfo.notProvided')],
    [t('profile.fields.sex'), patient.sex ? t(`profile.sex.${patient.sex}`) : t('patientInfo.notProvided')],
  ];

  return (
    <section className={className} data-patient-info="ready">
      {heading}
      {!compact && <p className="mb-4 text-xs text-muted sm:text-sm">{t('patientInfo.subtitle')}</p>}

      <div className="mb-3 flex items-center gap-3" data-patient-photo={photo ? 'shown' : 'initials'}>
        <Avatar src={photo} name={patient.name} size="lg" className="ring-2 ring-primary-soft" />
        <p className="min-w-0 truncate text-sm font-bold text-ink">{patient.name}</p>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        {summary.map(([label, value]) => (
          <div key={label} className="rounded-xl bg-subtle p-3">
            <dt className="text-2xs font-medium text-muted">{label}</dt>
            <dd className="mt-0.5 text-sm font-bold text-ink">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-2 rounded-xl border border-line p-3" data-emergency-contact={patient.emergencyContact ? 'shown' : 'hidden'}>
        <p className="text-2xs font-bold uppercase tracking-wider text-muted">{t('profile.emergency.title')}</p>
        {patient.emergencyContact ? (
          <p className="mt-1 text-sm text-ink">
            <span className="font-semibold">{patient.emergencyContact.name}</span>
            {patient.emergencyContact.relationship && <span className="text-muted"> · {patient.emergencyContact.relationship}</span>}
            <a href={`tel:${patient.emergencyContact.phone}`} className="mt-1 flex items-center gap-1.5 font-semibold text-primary hover:underline">
              <Phone className="h-3.5 w-3.5" /> {patient.emergencyContact.phone}
            </a>
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted">{appointment.activeConsultation ? t('patientInfo.noEmergencyContact') : t('patientInfo.emergencyDuringConsultation')}</p>
        )}
      </div>

      <div className="mt-4 space-y-3" data-patient-history>
        {HISTORY_TYPES.map((type) => {
          const list = byType(type);
          const Icon = TYPE_ICON[type];
          return (
            <div key={type} data-history-type={type}>
              <p className="flex items-center gap-1.5 text-xs font-bold text-ink">
                <Icon className="h-3.5 w-3.5 text-primary" /> {t(`patientInfo.types.${type}`)}
                <span className="font-medium text-muted">({list.length})</span>
              </p>
              {list.length ? (
                <ul className="mt-1.5 space-y-1.5">
                  {list.map((e) => (
                    <li key={e.id} className="rounded-lg bg-subtle/70 px-3 py-2 text-sm" data-entry-source={e.source}>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="break-words font-semibold text-ink">{e.title}</span>
                        {e.source === 'DOCTOR' && <Badge tone="blue">{e.authorName ? t('medical.byDoctor', { name: e.authorName }) : t('medical.byDoctorUnnamed')}</Badge>}
                      </span>
                      {e.description && <span className="mt-0.5 block whitespace-pre-line break-words text-xs text-muted">{e.description}</span>}
                      {e.recordedAt && <span className="mt-0.5 block text-2xs text-muted">{t('medical.recordedOn', { date: dateOnly(e.recordedAt, locale) })}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-muted">{t('patientInfo.noneProvided')}</p>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 flex items-start gap-1.5 text-2xs text-muted">
        <Lock className="mt-0.5 h-3 w-3 shrink-0" /> {t('patientInfo.readOnlyNote')}
      </p>
    </section>
  );
}
