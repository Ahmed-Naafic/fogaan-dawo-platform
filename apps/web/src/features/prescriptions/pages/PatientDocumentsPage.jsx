import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ClipboardList, FolderOpen, NotebookText, Search, Upload } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import Tabs from '@/components/ui/Tabs';
import Toggle from '@/components/ui/Toggle';
import { useToast } from '@/components/ui/Toast';
import { Dialog } from '@/features/appointments/components/AppointmentDialogs';
import { ConfirmDialog, Field } from '@/features/profile/components/ProfileParts';
import { useI18n } from '@/lib/i18n';
import ConsultationSummaryCard from '../components/ConsultationSummaryCard';
import DocumentsPanel, { DocumentRow } from '../components/DocumentsPanel';
import { RxPdfActions, RxStatusBadge } from '../components/RxParts';
import { rxErrorKey } from '../prescriptionUi';
import { archiveDocument, listMyDocuments, listMyPrescriptions, listMySummaries } from '../services/prescriptionApi';

const fmt = (iso, locale) => (iso ? new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

/**
 * /patient/documents — one place for the patient's prescriptions, consultation summaries and medical
 * documents. Only the signed-in patient's own records (the API enforces it); files open through the
 * authorised routes only.
 */
export default function PatientDocumentsPage() {
  const { t, lang, locale } = useI18n();
  const notify = useToast();
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [data, setData] = useState(undefined);
  const [summaryOf, setSummaryOf] = useState(null);
  const [uploadFor, setUploadFor] = useState(null); // consultationId | '' (choosing)
  const [archiving, setArchiving] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setData(undefined);
    Promise.all([listMyPrescriptions({ pageSize: 50 }), listMySummaries(), listMyDocuments({ includeArchived: showArchived })])
      .then(([rx, summaries, docs]) => setData({ rx: rx.items, summaries: summaries.items, docs: docs.items }))
      .catch(() => setData(null));
  }, [showArchived]);
  useEffect(load, [load]);

  const specialty = (s) => (s ? (lang === 'so' ? s.nameSo : s.nameEn) : '');
  const entries = useMemo(() => {
    if (!data) return [];
    const list = [
      ...data.rx.map((r) => ({ type: 'prescription', id: r.id, date: r.issuedAt, title: r.reference, doctor: r.doctor.name, search: `${r.reference} ${r.doctor.name}`, r })),
      ...data.summaries.map((s) => ({ type: 'summary', id: s.consultationId, date: s.completedAt, title: t('summary.title'), doctor: s.doctor.name, search: `${s.doctor.name} ${specialty(s.doctor.specialty)}`, s })),
      ...data.docs.map((d) => ({ type: 'document', id: d.id, date: d.createdAt, title: d.fileName, doctor: d.doctor.name, search: `${d.fileName} ${d.doctor.name} ${t(`docs.categories.${d.category}`)} ${d.description ?? ''}`, d })),
    ];
    const q = query.trim().toLowerCase();
    return list
      .filter((e) => kind === 'all' || e.type === kind)
      .filter((e) => !q || e.search.toLowerCase().includes(q))
      .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t/lang only relabel
  }, [data, kind, query, lang]);

  async function archive() {
    setBusy(true);
    try {
      await archiveDocument(archiving.id);
      setArchiving(null);
      notify(t('docs.archivedOk'), 'success');
      load();
    } catch (error) {
      notify(t(rxErrorKey(error)), 'error');
    } finally {
      setBusy(false);
    }
  }

  const counts = data ? { prescription: data.rx.length, summary: data.summaries.length, document: data.docs.length } : null;
  return (
    <>
      <PageHeader title={t('records.title')} subtitle={t('records.subtitle')} />
      <Card className="mb-5 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <Tabs
            className="lg:max-w-xl lg:flex-1"
            value={kind}
            onChange={setKind}
            items={[
              { value: 'all', label: t('records.filters.all') },
              { value: 'prescription', label: `${t('records.filters.prescriptions')}${counts ? ` (${counts.prescription})` : ''}` },
              { value: 'summary', label: `${t('records.filters.summaries')}${counts ? ` (${counts.summary})` : ''}` },
              { value: 'document', label: `${t('records.filters.documents')}${counts ? ` (${counts.document})` : ''}` },
            ]}
          />
          <Input icon={Search} className="lg:w-72" placeholder={t('records.search')} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('records.search')} name="records-search" />
          <Button variant="soft" onClick={() => setUploadFor('')} disabled={!data?.summaries.length} data-records-upload>
            <Upload className="h-4 w-4" /> {t('records.upload')}
          </Button>
        </div>
        <label className="mt-3 flex items-center justify-end gap-2 text-xs font-semibold text-muted">
          {t('records.showArchived')}
          <Toggle checked={showArchived} onChange={setShowArchived} label={t('records.showArchived')} />
        </label>
      </Card>

      {data === undefined && (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-20 animate-pulse" />
          ))}
        </div>
      )}
      {data === null && (
        <Card className="p-6 text-center" role="alert">
          <p className="text-sm text-muted">{t('records.loadFailed')}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={load}>
            {t('profile.retry')}
          </Button>
        </Card>
      )}
      {data && entries.length === 0 && (
        <Card className="flex flex-col items-center px-6 py-12 text-center" data-records-empty>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <FolderOpen className="h-6 w-6" />
          </span>
          <p className="mt-3 text-sm font-semibold text-ink">{query ? t('records.noMatches') : t('records.emptyTitle')}</p>
          <p className="mt-1 max-w-sm text-xs text-muted">{t('records.emptyBody')}</p>
        </Card>
      )}
      {data && entries.length > 0 && (
        <ul className="space-y-3" data-records-list>
          {entries.map((e) =>
            e.type === 'document' ? (
              <DocumentRow key={`d-${e.id}`} doc={e.d} onArchive={setArchiving} busy={busy} />
            ) : (
              <li key={`${e.type}-${e.id}`} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center" data-record={e.type}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  {e.type === 'prescription' ? <ClipboardList className="h-5 w-5" /> : <NotebookText className="h-5 w-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-ink">
                    {e.title}
                    {e.type === 'prescription' ? <RxStatusBadge status={e.r.status} /> : <Badge tone="blue">{t('records.kind.summary')}</Badge>}
                  </p>
                  <p className="text-xs text-muted">
                    {fmt(e.date, locale)} · {e.doctor}
                    {e.type === 'prescription' && ` · ${t('rx.itemCount', { count: e.r.itemCount })}`}
                    {e.type === 'summary' && ` · ${t('records.sharedSections', { count: e.s.sharedSectionCount })} · ${t('rx.itemCount', { count: e.s.prescriptionCount })}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {e.type === 'prescription' ? (
                    <>
                      <Button size="sm" variant="secondary" to={`/patient/prescriptions/${e.id}`}>
                        {t('rx.open')}
                      </Button>
                      <RxPdfActions rx={{ id: e.id, reference: e.r.reference, hasPdf: true }} compact />
                    </>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setSummaryOf(e.s)} data-summary-open>
                      {t('records.openSummary')}
                    </Button>
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      <p className="mt-5 text-2xs text-muted">{t('records.privacy')}</p>

      {summaryOf && (
        <Dialog title={t('summary.title')} onClose={() => setSummaryOf(null)} labelledBy="records-summary-title">
          <div className="max-h-[70vh] overflow-y-auto pr-1">
            <ConsultationSummaryCard consultationId={summaryOf.consultationId} role="PATIENT" />
            <Link to={`/patient/appointments/${summaryOf.appointmentId}`} className="mt-4 inline-block text-xs font-semibold text-primary hover:underline">
              {t('rx.openAppointment')}
            </Link>
          </div>
        </Dialog>
      )}
      {uploadFor !== null && data && (
        <Dialog title={t('records.upload')} onClose={() => (setUploadFor(null), load())} labelledBy="records-upload-title">
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1" data-records-upload-dialog>
            <Field label={t('records.chooseConsultation')} htmlFor="records-consultation">
              <Select id="records-consultation" value={uploadFor} onChange={(e) => setUploadFor(e.target.value)}>
                <option value="">{t('records.chooseConsultationPlaceholder')}</option>
                {data.summaries.map((s) => (
                  <option key={s.consultationId} value={s.consultationId}>
                    {fmt(s.completedAt, locale)} · {s.doctor.name}
                  </option>
                ))}
              </Select>
            </Field>
            {uploadFor && <DocumentsPanel key={uploadFor} consultationId={uploadFor} compact />}
          </div>
        </Dialog>
      )}
      {archiving && <ConfirmDialog title={t('docs.archiveTitle')} body={t('docs.archiveBody')} confirmLabel={t('docs.archive')} busy={busy} onCancel={() => setArchiving(null)} onConfirm={archive} />}
    </>
  );
}
