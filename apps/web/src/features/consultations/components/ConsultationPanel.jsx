import { useEffect, useState } from 'react';
import { Lock, MessageSquareText, X } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import Tabs from '@/components/ui/Tabs';
import Toggle from '@/components/ui/Toggle';
import ConsultationPrescriptions from '@/features/prescriptions/components/ConsultationPrescriptions';
import DocumentsPanel from '@/features/prescriptions/components/DocumentsPanel';
import CallChat from './CallChat';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import PatientInformationPanel from '@/features/profile/components/PatientInformationPanel';
import usePrivateImage from '@/features/profile/usePrivateImage';

/*
 * Consultation side panel. Real data only:
 *  - Consultation: the other participant and appointment time; the doctor's notes (saved through the
 *    existing note rules, locked 24 h after completion) with a per-section "share with patient" switch.
 *  - Prescriptions: drafts / issue (doctor, within the issuing window) or the issued list (patient).
 *  - Files: consultation documents shared between the patient and the assigned doctor.
 *  - Chat: text and image/PDF files (≤ 5 MB) saved to the consultation record (CallChat).
 */

const NOTE_FIELDS = ['complaint', 'assessment', 'diagnosis', 'advice'];
const SHARE_FLAG = { complaint: 'shareComplaint', assessment: 'shareAssessment', diagnosis: 'shareDiagnosis', advice: 'shareAdvice' };

function Unavailable({ icon: Icon, text }) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-subtle text-muted">
        <Icon className="h-6 w-6" />
      </span>
      <p className="mt-3 max-w-xs text-sm text-muted">{text}</p>
    </div>
  );
}

function DoctorNotes({ consult, onSaveNote }) {
  const { t } = useI18n();
  const notify = useToast();
  const [note, setNote] = useState(() => ({
    ...Object.fromEntries(NOTE_FIELDS.map((k) => [k, consult.note?.[k] ?? ''])),
    ...Object.fromEntries(NOTE_FIELDS.map((k) => [SHARE_FLAG[k], Boolean(consult.note?.[SHARE_FLAG[k]])])),
  }));
  const [saving, setSaving] = useState(false);
  const [lockedAt, setLockedAt] = useState(consult.note?.lockedAt ?? null);
  const locked = Boolean(lockedAt) && new Date(lockedAt) <= new Date();
  useEffect(() => setLockedAt(consult.note?.lockedAt ?? null), [consult.note?.lockedAt]);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await onSaveNote(note);
      setLockedAt(saved?.lockedAt ?? null);
      notify(t('consult.notesSaved'), 'success');
    } catch {
      notify(t('consult.notesSaveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <h3 className="text-sm font-bold">{t('consult.notes')}</h3>
      {NOTE_FIELDS.map((field) => (
        <div key={field}>
          <label htmlFor={`note-${field}`} className="mb-1.5 block text-xs font-semibold text-muted">
            {t(`consult.noteFields.${field}`)}
          </label>
          <Textarea id={`note-${field}`} rows={2} className="min-h-[64px]" maxLength={5000} value={note[field]} disabled={locked} onChange={(e) => setNote((n) => ({ ...n, [field]: e.target.value }))} />
          <span className="mt-1.5 flex items-center justify-end gap-2 text-2xs font-semibold text-muted">
            {t('summary.shareWithPatient')}
            <Toggle checked={note[SHARE_FLAG[field]]} onChange={(v) => !locked && setNote((n) => ({ ...n, [SHARE_FLAG[field]]: v }))} label={`${t('summary.shareWithPatient')}: ${t(`consult.noteFields.${field}`)}`} />
          </span>
        </div>
      ))}
      {locked ? (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Lock className="h-3.5 w-3.5" /> {t('consult.notesLocked')}
        </p>
      ) : (
        <Button type="submit" variant="secondary" className="w-full" disabled={saving || !consult.id}>
          {t('consult.saveNotes')}
        </Button>
      )}
    </form>
  );
}

function ConsultationTab({ consult, role, onSaveNote }) {
  const { t, locale } = useI18n();
  const other = role === 'DOCTOR' ? consult.patient : consult.doctor;
  const otherPhoto = usePrivateImage(role === 'DOCTOR' ? consult.patient?.photoUrl : null);
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-bold">{t(role === 'DOCTOR' ? 'consult.patientInfo' : 'consult.doctorInfo')}</h3>
        <div className="flex items-center gap-3.5">
          <Avatar src={otherPhoto} name={other.name} size="lg" />
          <div className="min-w-0 text-sm">
            <p className="truncate font-bold">{other.name}</p>
            <p className="text-xs text-muted">{formatDateTime(consult.appointment.startAtUtc, browserTimeZone(), locale)}</p>
          </div>
        </div>
        <p className="mt-3 text-2xs text-muted">{t('consult.noRecording')}</p>
      </section>
      {role === 'DOCTOR' && consult.patient?.id && (
        <section className="border-t border-line pt-5">
          <PatientInformationPanel compact patientId={consult.patient.id} appointmentId={consult.appointmentId} status={consult.appointment.status} />
        </section>
      )}
      <section className="border-t border-line pt-5">{role === 'DOCTOR' ? <DoctorNotes key={consult.id} consult={consult} onSaveNote={onSaveNote} /> : <p className="text-sm text-muted">{t('consult.notesPatient')}</p>}</section>
    </div>
  );
}

export default function ConsultationPanel({ consult, role, tab, setTab, onClose, onSaveNote }) {
  const { t } = useI18n();
  return (
    <aside className="flex h-full flex-col bg-surface" aria-label={t('consult.tabs.consultation')}>
      <div className="flex items-center">
        <Tabs
          variant="underline"
          value={tab}
          onChange={setTab}
          className="flex-1 px-2"
          items={[
            { value: 'consultation', label: t('consult.tabs.consultation') },
            { value: 'prescriptions', label: t('consult.tabs.prescriptions') },
            { value: 'chat', label: t('consult.tabs.chat') },
            { value: 'files', label: t('consult.tabs.files') },
          ]}
        />
        {onClose && (
          <button onClick={onClose} className="mr-2 rounded-lg p-2 text-muted hover:bg-subtle" aria-label={t('common.close')}>
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'consultation' && (consult ? <ConsultationTab consult={consult} role={role} onSaveNote={onSaveNote} /> : <p className="text-sm text-muted">{t('consult.panelBeforeJoin')}</p>)}
        {tab === 'chat' && (consult?.appointmentId ? <CallChat appointmentId={consult.appointmentId} consultationId={consult.id} /> : <Unavailable icon={MessageSquareText} text={t('consult.panelBeforeJoin')} />)}
        {tab === 'prescriptions' && (consult?.id ? <ConsultationPrescriptions consultationId={consult.id} role={role} compact refreshKey={consult.appointment?.status} /> : <p className="text-sm text-muted">{t('consult.panelBeforeJoin')}</p>)}
        {tab === 'files' && (consult?.id ? <DocumentsPanel consultationId={consult.id} compact /> : <p className="text-sm text-muted">{t('consult.panelBeforeJoin')}</p>)}
      </div>
    </aside>
  );
}
