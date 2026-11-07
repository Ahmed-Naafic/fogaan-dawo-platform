import { useState } from 'react';
import { AlertTriangle, Download, FileText, Pill, Plus, Printer, Trash2 } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { Dialog } from '@/features/appointments/components/AppointmentDialogs';
import { ConfirmDialog, Field, INVALID } from '@/features/profile/components/ProfileParts';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { emptyItem, itemsFrom, MAX_ITEMS, openBlob, printBlob, rxErrorKey, STATUS_TONE, validatePrescription, validReason } from '../prescriptionUi';
import { getPrescriptionPdf } from '../services/prescriptionApi';

export function RxStatusBadge({ status }) {
  const { t } = useI18n();
  return (
    <span data-rx-status={status}>
      <Badge tone={STATUS_TONE[status] ?? 'neutral'} className="uppercase tracking-wide">
        {t(`rx.status.${status}`)}
      </Badge>
    </span>
  );
}

const fmtDate = (iso, locale) => (iso ? new Date(iso).toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

/** Read-only medicine lines. */
export function RxItems({ items }) {
  const { t } = useI18n();
  return (
    <ol className="space-y-2.5" data-rx-items>
      {items.map((it, i) => (
        <li key={it.id ?? i} className="rounded-xl bg-subtle/70 p-3.5">
          <p className="flex items-start gap-2 text-sm font-bold text-ink">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-2xs text-primary-fg">{i + 1}</span>
            <span className="break-words">{it.medicineName}</span>
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
            {['dose', 'frequency', 'duration', 'quantity'].map((k) =>
              it[k] ? (
                <div key={k}>
                  <dt className="text-muted">{t(`rx.fields.${k}`)}</dt>
                  <dd className="break-words font-semibold text-ink">{it[k]}</dd>
                </div>
              ) : null,
            )}
          </dl>
          {it.instructions && (
            <p className="mt-2 text-xs text-ink">
              <span className="font-semibold">{t('rx.fields.instructions')}: </span>
              {it.instructions}
            </p>
          )}
          {it.warnings && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs font-semibold text-danger">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {it.warnings}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

/** View / download / print the stored PDF (only for issued prescriptions). */
export function RxPdfActions({ rx, compact = false }) {
  const { t } = useI18n();
  const notify = useToast();
  const [busy, setBusy] = useState(null);
  if (!rx.hasPdf) return null;
  const run = async (kind) => {
    setBusy(kind);
    try {
      const load = () => getPrescriptionPdf(rx.id);
      if (kind === 'print') await printBlob(load);
      else await openBlob(load, { fileName: `${rx.reference}.pdf`, download: kind === 'download' });
    } catch (error) {
      notify(t(rxErrorKey(error)), 'error');
    } finally {
      setBusy(null);
    }
  };
  const size = compact ? 'sm' : 'md';
  return (
    <div className="flex flex-wrap gap-2" data-rx-pdf>
      <Button size={size} variant="secondary" onClick={() => run('view')} disabled={busy !== null} data-rx-view-pdf>
        <FileText className="h-4 w-4" /> {t('rx.pdf.view')}
      </Button>
      <Button size={size} variant="secondary" onClick={() => run('download')} disabled={busy !== null} data-rx-download>
        <Download className="h-4 w-4" /> {t('rx.pdf.download')}
      </Button>
      <Button size={size} variant="secondary" onClick={() => run('print')} disabled={busy !== null} data-rx-print>
        <Printer className="h-4 w-4" /> {t('rx.pdf.print')}
      </Button>
    </div>
  );
}

/** Header facts: reference, status, dates, doctor; plus correction / cancellation notes. */
export function RxSummary({ rx }) {
  const { t, lang, locale } = useI18n();
  const specialty = rx.doctor?.specialty ? (lang === 'so' ? rx.doctor.specialty.nameSo : rx.doctor.specialty.nameEn) : '';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-extrabold text-ink" data-rx-reference>
          {rx.reference ?? t('rx.draftTitle')}
        </span>
        <RxStatusBadge status={rx.status} />
      </div>
      <p className="text-xs text-muted">
        {rx.issuedAt ? t('rx.issuedOn', { date: fmtDate(rx.issuedAt, locale) }) : t('rx.notIssued')} · {rx.doctor?.name}
        {specialty && ` · ${specialty}`}
      </p>
      {rx.status === 'CANCELLED' && (
        <p className="rounded-xl border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-xs text-danger" role="note">
          <span className="font-bold">{t('rx.cancelledNote', { date: fmtDate(rx.cancelledAt, locale) })}</span>
          {rx.cancellationReason && <span className="mt-0.5 block text-ink">{rx.cancellationReason}</span>}
        </p>
      )}
      {rx.status === 'REPLACED' && (
        <p className="rounded-xl border border-amber-300/60 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200" role="note">
          <span className="font-bold">{t('rx.replacedNote', { reference: rx.replacedBy?.reference ?? '', date: fmtDate(rx.replacedAt, locale) })}</span>
          {rx.replacementReason && <span className="mt-0.5 block">{rx.replacementReason}</span>}
        </p>
      )}
      {rx.replaces && <p className="text-xs text-muted">{t('rx.replacesNote', { reference: rx.replaces.reference })}</p>}
    </div>
  );
}

/** Editable medicine lines (1–10) + general notes. `invalid` holds error keys by path. */
export function RxEditor({ items, setItems, notes, setNotes, invalid = {}, idPrefix = 'rx' }) {
  const { t } = useI18n();
  const set = (i, field, value) => setItems((list) => list.map((it, j) => (j === i ? { ...it, [field]: value } : it)));
  const field = (i, name, { textarea = false, max } = {}) => {
    const id = `${idPrefix}-${i}-${name}`;
    const err = invalid[`items.${i}.${name}`];
    return (
      <Field label={t(`rx.fields.${name}`)} htmlFor={id} error={err} className={textarea ? 'sm:col-span-2' : undefined}>
        {textarea ? (
          <Textarea id={id} rows={2} maxLength={max} value={items[i][name]} onChange={(e) => set(i, name, e.target.value)} className={err ? INVALID : undefined} />
        ) : (
          <Input id={id} maxLength={max} value={items[i][name]} onChange={(e) => set(i, name, e.target.value)} inputClassName={err ? INVALID : undefined} data-rx-field={name} />
        )}
      </Field>
    );
  };
  return (
    <div className="space-y-4" data-rx-editor>
      {items.map((_, i) => (
        <fieldset key={i} className="rounded-2xl border border-line p-4" data-rx-line={i}>
          <legend className="flex items-center gap-1.5 px-1 text-xs font-bold text-ink">
            <Pill className="h-3.5 w-3.5 text-primary" /> {t('rx.medicineN', { n: i + 1 })}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">{field(i, 'medicineName', { max: 180 })}</div>
            {field(i, 'dose', { max: 120 })}
            {field(i, 'frequency', { max: 120 })}
            {field(i, 'duration', { max: 120 })}
            {field(i, 'quantity', { max: 60 })}
            {field(i, 'instructions', { textarea: true, max: 1000 })}
            {field(i, 'warnings', { textarea: true, max: 1000 })}
          </div>
          {items.length > 1 && (
            <div className="mt-2 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setItems((list) => list.filter((__, j) => j !== i))} aria-label={t('rx.removeMedicine', { n: i + 1 })}>
                <Trash2 className="h-4 w-4" /> {t('rx.remove')}
              </Button>
            </div>
          )}
        </fieldset>
      ))}
      {invalid.items && <p className="text-2xs font-medium text-danger">{t(invalid.items)}</p>}
      <Button variant="soft" size="sm" onClick={() => setItems((list) => [...list, emptyItem()])} disabled={items.length >= MAX_ITEMS} data-rx-add-line>
        <Plus className="h-4 w-4" /> {t('rx.addMedicine')} <span className="text-muted">({items.length}/{MAX_ITEMS})</span>
      </Button>
      <Field label={t('rx.fields.generalNotes')} htmlFor={`${idPrefix}-notes`} error={invalid.generalNotes} hint={t('profile.optionalHint')}>
        <Textarea id={`${idPrefix}-notes`} rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <p className="text-2xs text-muted">{t('rx.noSuggestions')}</p>
    </div>
  );
}

function ReasonField({ value, onChange, error, id }) {
  const { t } = useI18n();
  return (
    <Field label={t('rx.reason')} htmlFor={id} error={error} hint={t('rx.reasonHint')}>
      <Textarea id={id} rows={3} maxLength={500} value={value} onChange={(e) => onChange(e.target.value)} className={error ? INVALID : undefined} data-rx-reason />
    </Field>
  );
}

export function IssueDialog({ rx, busy, onCancel, onConfirm }) {
  const { t } = useI18n();
  return (
    <ConfirmDialog title={t('rx.issueTitle')} body={t('rx.issueBody')} confirmLabel={t('rx.issue')} tone="primary" busy={busy} onCancel={onCancel} onConfirm={onConfirm}>
      <RxItems items={rx.items} />
    </ConfirmDialog>
  );
}

export function CancelRxDialog({ busy, onCancel, onConfirm }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  return (
    <ConfirmDialog
      title={t('rx.cancelTitle')}
      body={t('rx.cancelBody')}
      confirmLabel={t('rx.cancelConfirm')}
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => (validReason(reason) ? onConfirm(reason.trim()) : setError('rx.errors.reason'))}
    >
      <ReasonField id="rx-cancel-reason" value={reason} onChange={setReason} error={error} />
    </ConfirmDialog>
  );
}

/** Correction: edit a copy of the content + give a reason; the original stays as REPLACED. */
export function ReplaceRxDialog({ rx, busy, onCancel, onConfirm }) {
  const { t } = useI18n();
  const [items, setItems] = useState(() => itemsFrom(rx.items));
  const [notes, setNotes] = useState(rx.generalNotes ?? '');
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState({});
  const submit = () => {
    const { errors, payload } = validatePrescription({ items, generalNotes: notes });
    const all = { ...errors, ...(validReason(reason) ? {} : { reason: 'rx.errors.reason' }) };
    setInvalid(all);
    if (payload && !all.reason) onConfirm({ ...payload, reason: reason.trim() });
  };
  return (
    <Dialog title={t('rx.replaceTitle')} onClose={onCancel} busy={busy} labelledBy="rx-replace-title">
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1" data-rx-replace>
        <p className="text-sm text-muted">{t('rx.replaceBody', { reference: rx.reference })}</p>
        <ReasonField id="rx-replace-reason" value={reason} onChange={setReason} error={invalid.reason} />
        <RxEditor items={items} setItems={setItems} notes={notes} setNotes={setNotes} invalid={invalid} idPrefix="rx-replace" />
      </div>
      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button onClick={submit} disabled={busy} data-confirm>
          {busy ? t('auth.pleaseWait') : t('rx.replaceConfirm')}
        </Button>
      </div>
    </Dialog>
  );
}

export function RxLifecycle({ status }) {
  const { t } = useI18n();
  const steps = ['DRAFT', 'VALID', status === 'REPLACED' ? 'REPLACED' : 'CANCELLED'];
  const reached = { DRAFT: 0, VALID: 1, CANCELLED: 2, REPLACED: 2 }[status] ?? 0;
  return (
    <ol className="flex items-center gap-2 text-2xs font-semibold" aria-label={t('rx.lifecycle')}>
      {steps.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className={cn('rounded-full px-2 py-0.5', i <= reached && (i < 2 || reached === 2) ? 'bg-primary-soft text-primary' : 'bg-subtle text-muted')}>{t(`rx.status.${s}`)}</span>
          {i < steps.length - 1 && <span className="text-muted">→</span>}
        </li>
      ))}
    </ol>
  );
}
