import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, HeartPulse, Info, Lock, Pencil, Pill, Plus, ShieldAlert, Stethoscope } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Input';
import Toggle from '@/components/ui/Toggle';
import { useToast } from '@/components/ui/Toast';
import { Dialog } from '@/features/appointments/components/AppointmentDialogs';
import { useI18n } from '@/lib/i18n';
import { ConfirmDialog, ErrorState, Field, INVALID } from '../components/ProfileParts';
import { apiFieldErrors, dateOnly, emptyEntry, entryChanges, entryForm, HISTORY_TYPES, profileErrorKey, validateEntry } from '../profileUi';
import { addHistoryEntry, archiveHistoryEntry, listHistory, updateHistoryEntry } from '../services/profileApi';

const TYPE_ICON = { ALLERGY: ShieldAlert, CONDITION: HeartPulse, MEDICATION: Pill, SURGERY: Stethoscope, FAMILY_HISTORY: Info, OTHER: Info };
/** Shown first: what a clinician needs in an emergency. */
const EMERGENCY_TYPES = ['ALLERGY', 'CONDITION', 'MEDICATION'];

function EntryDialog({ entry, onClose, onSaved }) {
  const { t } = useI18n();
  const notify = useToast();
  const [form, setForm] = useState(entry ? entryForm(entry) : emptyEntry());
  const [invalid, setInvalid] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (name) => (e) => {
    setForm((f) => ({ ...f, [name]: e.target.value }));
    if (invalid[name]) setInvalid((s) => ({ ...s, [name]: null }));
  };

  async function save() {
    const { errors, payload } = validateEntry(form);
    if (!payload) return setInvalid(errors);
    const body = entry ? entryChanges(payload, entry) : payload;
    if (entry && !Object.keys(body).length) return onClose();
    setBusy(true);
    try {
      const saved = entry ? await updateHistoryEntry(entry.id, body) : await addHistoryEntry(body);
      notify(t(entry ? 'medical.updated' : 'medical.added'), 'success');
      onSaved(saved);
    } catch (error) {
      setInvalid(apiFieldErrors(error));
      notify(t(profileErrorKey(error)), 'error');
      setBusy(false);
    }
  }

  return (
    <Dialog title={t(entry ? 'medical.editTitle' : 'medical.addTitle')} onClose={onClose} busy={busy} labelledBy="medical-entry-title">
      <div className="space-y-4" data-entry-dialog>
        <Field label={t('medical.fields.type')} htmlFor="me-type" error={invalid.entryType}>
          <Select id="me-type" value={form.entryType} onChange={set('entryType')}>
            {HISTORY_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`medical.types.${type}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('medical.fields.title')} htmlFor="me-title" error={invalid.title}>
          <Input id="me-title" value={form.title} onChange={set('title')} maxLength={180} inputClassName={invalid.title ? INVALID : undefined} placeholder={t(`medical.placeholders.${form.entryType}`)} />
        </Field>
        <Field label={t('medical.fields.description')} htmlFor="me-description" error={invalid.description} hint={t('profile.optionalHint')}>
          <Textarea id="me-description" rows={3} value={form.description} onChange={set('description')} maxLength={4000} />
        </Field>
        <Field label={t('medical.fields.recordedAt')} htmlFor="me-recordedAt" error={invalid.recordedAt} hint={t('profile.optionalHint')}>
          <Input id="me-recordedAt" type="date" value={form.recordedAt} onChange={set('recordedAt')} max={new Date().toISOString().slice(0, 10)} min="1900-01-01" />
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={save} disabled={busy} data-entry-save>
            {busy ? t('auth.pleaseWait') : t('medical.save')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function EntryRow({ entry, onEdit, onArchive }) {
  const { t, locale } = useI18n();
  const Icon = TYPE_ICON[entry.entryType] ?? Info;
  const fromDoctor = entry.source === 'DOCTOR';
  return (
    <li className="flex items-start gap-3 border-b border-line py-4 last:border-0" data-entry={entry.id} data-source={entry.source}>
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="break-words text-sm font-bold text-ink">{entry.title}</p>
          <Badge tone="neutral">{t(`medical.types.${entry.entryType}`)}</Badge>
          {fromDoctor && (
            <Badge tone="blue" icon={Lock}>
              {entry.authorName ? t('medical.byDoctor', { name: entry.authorName }) : t('medical.byDoctorUnnamed')}
            </Badge>
          )}
          {entry.archivedAt && <Badge tone="neutral">{t('medical.archived')}</Badge>}
        </div>
        {entry.description && <p className="mt-1 whitespace-pre-line break-words text-sm text-muted">{entry.description}</p>}
        <p className="mt-1 text-2xs text-muted">
          {entry.recordedAt ? t('medical.recordedOn', { date: dateOnly(entry.recordedAt, locale) }) : t('medical.addedOn', { date: dateOnly(entry.createdAt, locale) })}
          {entry.archivedAt && ` · ${t('medical.archivedOn', { date: dateOnly(entry.archivedAt, locale) })}`}
        </p>
      </div>
      {!entry.archivedAt && (
        <div className="flex shrink-0 gap-1">
          {entry.canEdit && (
            <Button variant="ghost" size="icon" onClick={() => onEdit(entry)} aria-label={t('medical.edit')} title={t('medical.edit')} data-entry-edit>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {entry.canArchive && (
            <Button variant="ghost" size="icon" onClick={() => onArchive(entry)} aria-label={t('medical.archive')} title={t('medical.archive')} data-entry-archive>
              <Archive className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/** /patient/records — the patient's own longitudinal medical history (separate from consultation records). */
export default function MedicalInformationPage() {
  const { t } = useI18n();
  const notify = useToast();
  const [entries, setEntries] = useState(undefined);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(null); // null | 'new' | entry
  const [archiving, setArchiving] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setEntries(undefined);
    listHistory({ includeArchived: showArchived })
      .then((d) => setEntries(d.entries))
      .catch((error) => {
        setEntries(null);
        notify(t(profileErrorKey(error)), 'error');
      });
  }, [showArchived, notify, t]);
  useEffect(load, [load]);

  const active = useMemo(() => (entries ?? []).filter((e) => !e.archivedAt), [entries]);
  const archived = useMemo(() => (entries ?? []).filter((e) => e.archivedAt), [entries]);
  const emergency = EMERGENCY_TYPES.map((type) => [type, active.filter((e) => e.entryType === type)]);

  async function archive() {
    setBusy(true);
    try {
      await archiveHistoryEntry(archiving.id);
      setArchiving(null);
      notify(t('medical.archivedOk'), 'success');
      load();
    } catch (error) {
      notify(t(profileErrorKey(error)), 'error');
    } finally {
      setBusy(false);
    }
  }

  const header = <PageHeader title={t('medical.title')} subtitle={t('medical.subtitle')} />;

  return (
    <>
      {header}
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Card className="p-5 sm:p-6">
            <CardHeader
              title={t('medical.historyTitle')}
              subtitle={t('medical.historySubtitle')}
              action={
                <Button size="sm" onClick={() => setEditing('new')} data-entry-add>
                  <Plus className="h-4 w-4" /> <span className="hidden sm:inline">{t('medical.add')}</span>
                </Button>
              }
            />
            <div className="-mt-1 mb-3 flex items-center justify-end gap-2 text-xs font-semibold text-muted">
              <span id="show-archived-label">{t('medical.showArchived')}</span>
              <Toggle checked={showArchived} onChange={setShowArchived} label={t('medical.showArchived')} />
            </div>
            {entries === undefined && <div className="h-40 animate-pulse rounded-xl bg-subtle" aria-busy="true" />}
            {entries === null && <ErrorState onRetry={load} />}
            {entries && active.length === 0 && (
              <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center" data-empty>
                <p className="text-sm font-semibold text-ink">{t('medical.emptyTitle')}</p>
                <p className="mt-1 text-xs text-muted">{t('medical.emptyBody')}</p>
                <Button size="sm" variant="soft" className="mt-4" onClick={() => setEditing('new')}>
                  <Plus className="h-4 w-4" /> {t('medical.add')}
                </Button>
              </div>
            )}
            {entries && active.length > 0 && (
              <ul data-entries>
                {active.map((e) => (
                  <EntryRow key={e.id} entry={e} onEdit={setEditing} onArchive={setArchiving} />
                ))}
              </ul>
            )}
          </Card>
          {showArchived && entries && (
            <Card className="p-5 sm:p-6">
              <CardHeader title={t('medical.archivedTitle')} subtitle={t('medical.archivedSubtitle')} />
              {archived.length ? (
                <ul>
                  {archived.map((e) => (
                    <EntryRow key={e.id} entry={e} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">{t('medical.noArchived')}</p>
              )}
            </Card>
          )}
        </div>
        <aside className="min-w-0 space-y-6">
          <Card className="p-5">
            <CardHeader title={t('medical.emergencyTitle')} subtitle={t('medical.emergencySubtitle')} />
            <dl className="space-y-3">
              {emergency.map(([type, list]) => (
                <div key={type}>
                  <dt className="text-2xs font-bold uppercase tracking-wider text-muted">{t(`medical.typesPlural.${type}`)}</dt>
                  <dd className="mt-1 text-sm text-ink">{list.length ? list.map((e) => e.title).join(', ') : <span className="text-muted">{t('medical.noneRecorded')}</span>}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card className="p-5">
            <CardHeader title={t('medical.aboutTitle')} />
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
              <li>{t('medical.about.private')}</li>
              <li>{t('medical.about.doctorEntries')}</li>
              <li>{t('medical.about.archive')}</li>
              <li>{t('medical.about.consultations')}</li>
            </ul>
          </Card>
        </aside>
      </div>

      {editing && (
        <EntryDialog
          entry={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {archiving && (
        <ConfirmDialog
          title={t('medical.archiveTitle')}
          body={archiving.source === 'DOCTOR' ? t('medical.archiveBodyDoctor') : t('medical.archiveBody')}
          confirmLabel={t('medical.archive')}
          busy={busy}
          onCancel={() => setArchiving(null)}
          onConfirm={archive}
        />
      )}
    </>
  );
}
