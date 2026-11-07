import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Download, Eye, FileImage, FileText, Upload } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog, Field } from '@/features/profile/components/ProfileParts';
import { useI18n } from '@/lib/i18n';
import { checkDocumentFile, DOCUMENT_ACCEPT, DOCUMENT_CATEGORIES, formatBytes, openBlob, rxErrorKey } from '../prescriptionUi';
import { archiveDocument, downloadDocument, listConsultationDocuments, uploadDocument } from '../services/prescriptionApi';

const fmt = (iso, locale) => (iso ? new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

/** One document row with view / download / archive. Used here and on the patient documents page. */
export function DocumentRow({ doc, onArchive, busy }) {
  const { t, locale } = useI18n();
  const notify = useToast();
  const Icon = doc.mimeType === 'application/pdf' ? FileText : FileImage;
  const get = (download) => openBlob(() => downloadDocument(doc.id), { fileName: doc.fileName, download }).catch((e) => notify(t(rxErrorKey(e)), 'error'));
  return (
    <li className="flex items-start gap-3 rounded-xl border border-line p-3" data-document={doc.id} data-uploaded-by={doc.uploadedBy.role}>
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-ink" title={doc.fileName}>
          {doc.fileName}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-muted">
          <Badge tone="neutral">{t(`docs.categories.${doc.category}`)}</Badge>
          {t(doc.uploadedBy.isMe ? 'docs.uploadedByYou' : `docs.uploadedBy.${doc.uploadedBy.role}`, { name: doc.uploadedBy.name })} · {fmt(doc.createdAt, locale)} · {formatBytes(doc.fileSize)}
          {doc.archivedAt && <Badge tone="neutral">{t('docs.archived')}</Badge>}
        </p>
        {doc.description && <p className="mt-1 break-words text-xs text-ink">{doc.description}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        <Button size="icon" variant="ghost" onClick={() => get(false)} aria-label={t('docs.view')} title={t('docs.view')} data-doc-view>
          <Eye className="h-4 w-4" />
        </Button>
        <Button size="icon" variant="ghost" onClick={() => get(true)} aria-label={t('docs.download')} title={t('docs.download')} data-doc-download>
          <Download className="h-4 w-4" />
        </Button>
        {doc.canArchive && onArchive && (
          <Button size="icon" variant="ghost" onClick={() => onArchive(doc)} disabled={busy} aria-label={t('docs.archive')} title={t('docs.archive')} data-doc-archive>
            <Archive className="h-4 w-4" />
          </Button>
        )}
      </div>
    </li>
  );
}

/** Documents of one consultation: upload (patient or assigned doctor), list, archive. */
export default function DocumentsPanel({ consultationId, compact = false }) {
  const { t } = useI18n();
  const notify = useToast();
  const fileInput = useRef(null);
  const [items, setItems] = useState(undefined);
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState('LAB_RESULT');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(null);
  const [archiving, setArchiving] = useState(null);

  const load = useCallback(() => {
    if (!consultationId) return;
    listConsultationDocuments(consultationId)
      .then((d) => setItems(d.items))
      .catch(() => setItems(null));
  }, [consultationId]);
  useEffect(load, [load]);

  const choose = (f) => {
    const problem = checkDocumentFile(f);
    if (problem && f) {
      notify(t(problem), 'error');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setFile(f ?? null);
  };

  async function upload() {
    const problem = checkDocumentFile(file);
    if (problem) return notify(t(problem), 'error');
    setBusy('upload');
    try {
      await uploadDocument(consultationId, file, { category, description: description.trim() || undefined });
      setFile(null);
      setDescription('');
      if (fileInput.current) fileInput.current.value = '';
      notify(t('docs.uploaded'), 'success');
      load();
    } catch (error) {
      notify(t(rxErrorKey(error)), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function archive() {
    setBusy('archive');
    try {
      await archiveDocument(archiving.id);
      setArchiving(null);
      notify(t('docs.archivedOk'), 'success');
      load();
    } catch (error) {
      notify(t(rxErrorKey(error)), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section data-documents-panel>
      <h3 className={compact ? 'mb-3 text-sm font-bold' : 'mb-1 text-base font-bold sm:text-[17px]'}>{t('docs.title')}</h3>
      {!compact && <p className="mb-4 text-xs text-muted sm:text-sm">{t('docs.subtitle')}</p>}

      <div className="mb-4 space-y-3 rounded-2xl border border-line p-3 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('docs.category')} htmlFor={`doc-cat-${consultationId}`}>
            <Select id={`doc-cat-${consultationId}`} value={category} onChange={(e) => setCategory(e.target.value)} data-doc-category>
              {DOCUMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`docs.categories.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('docs.description')} htmlFor={`doc-desc-${consultationId}`} hint={t('profile.optionalHint')}>
            <Input id={`doc-desc-${consultationId}`} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
        <input ref={fileInput} type="file" accept={DOCUMENT_ACCEPT} onChange={(e) => choose(e.target.files?.[0])} className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary" data-doc-file aria-label={t('docs.chooseFile')} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-2xs text-muted">{t('docs.rules')}</p>
          <Button size="sm" onClick={upload} disabled={!file || busy !== null} data-doc-upload>
            <Upload className="h-4 w-4" /> {busy === 'upload' ? t('auth.pleaseWait') : t('docs.upload')}
          </Button>
        </div>
      </div>

      {items === undefined && <div className="h-14 animate-pulse rounded-xl bg-subtle" aria-busy="true" />}
      {items === null && (
        <p className="text-sm text-muted">
          {t('docs.loadFailed')}{' '}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={load}>
            {t('profile.retry')}
          </button>
        </p>
      )}
      {items && items.length === 0 && <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-sm text-muted" data-docs-empty>{t('docs.empty')}</p>}
      {items && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((d) => (
            <DocumentRow key={d.id} doc={d} onArchive={setArchiving} busy={busy !== null} />
          ))}
        </ul>
      )}
      <p className="mt-3 text-2xs text-muted">{t('docs.privacy')}</p>
      {archiving && <ConfirmDialog title={t('docs.archiveTitle')} body={t('docs.archiveBody')} confirmLabel={t('docs.archive')} busy={busy === 'archive'} onCancel={() => setArchiving(null)} onConfirm={archive} />}
    </section>
  );
}
