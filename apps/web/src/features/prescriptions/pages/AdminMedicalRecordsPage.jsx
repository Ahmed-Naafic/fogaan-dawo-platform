/** Admin › Medical records: prescriptions, documents and the clinical audit trail as metadata only (no clinical content). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ClipboardCheck, ClipboardList, ClipboardX, FileStack, HardDrive, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import Tabs from '@/components/ui/Tabs';
import { useI18n } from '@/lib/i18n';
import { RxStatusBadge } from '../components/RxParts';
import { DOCUMENT_CATEGORIES, formatBytes } from '../prescriptionUi';
import { adminRecordsAudit, adminRecordsDocuments, adminRecordsOverview, adminRecordsPrescriptions } from '../services/prescriptionApi';

const fmt = (iso, locale) => (iso ? new Date(iso).toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

function Tile({ icon: Icon, label, value, testId }) {
  return (
    <Card className="flex items-center gap-3 p-4" data-tile={testId}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-2xs font-semibold text-muted">{label}</p>
        <p className="text-lg font-extrabold text-ink">{value}</p>
      </div>
    </Card>
  );
}

function Pager({ data, onPage }) {
  const { t } = useI18n();
  if (!data) return null;
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-center gap-3 text-sm">
      <Button size="sm" variant="secondary" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>
        {t('rx.prev')}
      </Button>
      <span className="text-muted">{t('rx.pageOf', { page: data.page, pages })}</span>
      <Button size="sm" variant="secondary" disabled={data.page >= pages} onClick={() => onPage(data.page + 1)}>
        {t('rx.next')}
      </Button>
    </div>
  );
}

function useList(loader, params) {
  const [data, setData] = useState(undefined);
  const latest = useRef(0); // only the newest request may update the list (filters can change quickly)
  const key = JSON.stringify(params);
  const load = useCallback(() => {
    const id = (latest.current += 1);
    setData(undefined);
    loader(JSON.parse(key))
      .then((d) => id === latest.current && setData(d))
      .catch(() => id === latest.current && setData(null));
  }, [loader, key]);
  useEffect(load, [load]);
  return [data, load];
}

function TableState({ data, onRetry, empty }) {
  const { t } = useI18n();
  if (data === undefined) return <div className="h-32 animate-pulse rounded-xl bg-subtle" aria-busy="true" />;
  if (data === null) {
    return (
      <div className="py-6 text-center" role="alert">
        <p className="text-sm text-muted">{t('adminRecords.loadFailed')}</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          {t('profile.retry')}
        </Button>
      </div>
    );
  }
  if (!data.items.length) return <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-muted">{empty}</p>;
  return null;
}

function PrescriptionsTab() {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, load] = useList(adminRecordsPrescriptions, { status: status || undefined, q: search || undefined, page });
  return (
    <>
      <form
        className="mb-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q.trim());
          setPage(1);
        }}
      >
        <Select className="sm:w-48" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label={t('adminRecords.status')} name="rx-status">
          <option value="">{t('rx.filters.all')}</option>
          {['VALID', 'CANCELLED', 'REPLACED'].map((s) => (
            <option key={s} value={s}>
              {t(`rx.status.${s}`)}
            </option>
          ))}
        </Select>
        <Input icon={Search} className="sm:flex-1" placeholder={t('adminRecords.searchRx')} value={q} onChange={(e) => setQ(e.target.value)} name="rx-q" aria-label={t('adminRecords.searchRx')} />
        <Button type="submit" variant="secondary">
          {t('adminRecords.searchBtn')}
        </Button>
      </form>
      <TableState data={data} onRetry={load} empty={t('adminRecords.emptyRx')} />
      {data?.items?.length > 0 && (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[720px] text-left text-sm" data-admin-rx>
            <thead className="text-2xs uppercase tracking-wider text-muted">
              <tr>
                {['reference', 'status', 'doctor', 'patientRef', 'issued', 'cancelledReplaced', 'lines'].map((h) => (
                  <th key={h} className="px-2 py-2 font-semibold">
                    {t(`adminRecords.cols.${h}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((r) => (
                <tr key={r.id} data-admin-rx-row={r.status}>
                  <td className="px-2 py-2.5 font-semibold text-ink">{r.reference}</td>
                  <td className="px-2 py-2.5">
                    <RxStatusBadge status={r.status} />
                  </td>
                  <td className="px-2 py-2.5">{r.doctor.name}</td>
                  <td className="px-2 py-2.5 font-mono text-xs text-muted">{r.patientRef}</td>
                  <td className="px-2 py-2.5 text-xs">{fmt(r.issuedAt, locale)}</td>
                  <td className="px-2 py-2.5 text-xs">
                    {r.cancelledAt ? fmt(r.cancelledAt, locale) : r.replacedAt ? `${fmt(r.replacedAt, locale)} → ${r.replacedBy ?? ''}` : '—'}
                    {r.replaces && <span className="block text-muted">{t('adminRecords.replaces', { reference: r.replaces })}</span>}
                  </td>
                  <td className="px-2 py-2.5 text-xs">{r.itemCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager data={data} onPage={setPage} />
    </>
  );
}

function DocumentsTab() {
  const { t, locale } = useI18n();
  const [category, setCategory] = useState('');
  const [archived, setArchived] = useState('');
  const [page, setPage] = useState(1);
  const [data, load] = useList(adminRecordsDocuments, { category: category || undefined, archived: archived || undefined, page });
  return (
    <>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Select className="sm:w-64" value={category} onChange={(e) => (setCategory(e.target.value), setPage(1))} aria-label={t('docs.category')} name="doc-category">
          <option value="">{t('adminRecords.allCategories')}</option>
          {DOCUMENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`docs.categories.${c}`)}
            </option>
          ))}
        </Select>
        <Select className="sm:w-48" value={archived} onChange={(e) => (setArchived(e.target.value), setPage(1))} aria-label={t('adminRecords.archiveState')} name="doc-archived">
          <option value="">{t('adminRecords.anyState')}</option>
          <option value="false">{t('adminRecords.active')}</option>
          <option value="true">{t('docs.archived')}</option>
        </Select>
      </div>
      <TableState data={data} onRetry={load} empty={t('adminRecords.emptyDocs')} />
      {data?.items?.length > 0 && (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[720px] text-left text-sm" data-admin-docs>
            <thead className="text-2xs uppercase tracking-wider text-muted">
              <tr>
                {['category', 'type', 'size', 'uploadedBy', 'doctor', 'patientRef', 'uploaded', 'archived'].map((h) => (
                  <th key={h} className="px-2 py-2 font-semibold">
                    {t(`adminRecords.cols.${h}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.items.map((d) => (
                <tr key={d.id}>
                  <td className="px-2 py-2.5">{t(`docs.categories.${d.category}`)}</td>
                  <td className="px-2 py-2.5 text-xs">{d.mimeType === 'application/pdf' ? 'PDF' : d.mimeType === 'image/png' ? 'PNG' : 'JPEG'}</td>
                  <td className="px-2 py-2.5 text-xs">{formatBytes(d.fileSize)}</td>
                  <td className="px-2 py-2.5 text-xs">{t(`roles.${d.uploadedBy.toLowerCase()}`)}</td>
                  <td className="px-2 py-2.5">{d.doctor.name}</td>
                  <td className="px-2 py-2.5 font-mono text-xs text-muted">{d.patientRef}</td>
                  <td className="px-2 py-2.5 text-xs">{fmt(d.uploadedAt, locale)}</td>
                  <td className="px-2 py-2.5 text-xs">{d.archivedAt ? fmt(d.archivedAt, locale) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager data={data} onPage={setPage} />
    </>
  );
}

const AUDIT_ENTITIES = ['Prescription', 'MedicalDocument', 'PatientMedicalHistoryAccess', 'SecurityEvent'];

function AuditTab() {
  const { t, locale } = useI18n();
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);
  const [data, load] = useList(adminRecordsAudit, { entityType: entityType || undefined, page });
  const describe = (v) => (v ? Object.entries(v).map(([k, val]) => `${k}: ${typeof val === 'object' ? JSON.stringify(val) : val}`).join(' · ') : '');
  return (
    <>
      <Select className="mb-4 sm:w-72" value={entityType} onChange={(e) => (setEntityType(e.target.value), setPage(1))} aria-label={t('adminRecords.eventType')} name="audit-entity">
        <option value="">{t('adminRecords.allEvents')}</option>
        {AUDIT_ENTITIES.map((e) => (
          <option key={e} value={e}>
            {t(`adminRecords.entities.${e}`)}
          </option>
        ))}
      </Select>
      <TableState data={data} onRetry={load} empty={t('adminRecords.emptyAudit')} />
      {data?.items?.length > 0 && (
        <ul className="divide-y divide-line" data-admin-audit>
          {data.items.map((a) => (
            <li key={a.id} className="py-3 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={a.entityType === 'SecurityEvent' ? 'red' : 'neutral'}>{t(`adminRecords.entities.${a.entityType}`)}</Badge>
                <span className="font-semibold text-ink">{a.after?.action ?? a.action}</span>
                <span className="text-xs text-muted">{fmt(a.at, locale)}</span>
              </p>
              <p className="mt-1 text-xs text-muted">
                {a.actor ? `${a.actor.name ?? `${t(`roles.${a.actor.role.toLowerCase()}`)} ${a.actor.ref}`} · ` : ''}
                {t('adminRecords.ref')} {a.entityRef}
                {describe(a.after) && ` · ${describe(a.after)}`}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Pager data={data} onPage={setPage} />
    </>
  );
}

/** /admin/medical-records — prescription & document monitoring, metadata only. */
export default function AdminMedicalRecordsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState('prescriptions');
  const [overview, setOverview] = useState(undefined);
  const loadOverview = useCallback(() => {
    setOverview(undefined);
    adminRecordsOverview()
      .then(setOverview)
      .catch(() => setOverview(null));
  }, []);
  useEffect(loadOverview, [loadOverview]);
  const o = overview;
  return (
    <>
      <PageHeader title={t('adminRecords.title')} subtitle={t('adminRecords.subtitle')} />
      <p className="mb-4 flex items-start gap-2 rounded-xl border border-primary/30 bg-primary-soft/40 px-4 py-3 text-xs text-ink" role="note">
        <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-primary" /> {t('adminRecords.privacy')}
      </p>
      {o === undefined && <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="card h-20 animate-pulse" />)}</div>}
      {o === null && (
        <Card className="mb-5 p-5 text-center" role="alert">
          <p className="text-sm text-muted">{t('adminRecords.loadFailed')}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={loadOverview}>
            <RefreshCw className="h-4 w-4" /> {t('profile.retry')}
          </Button>
        </Card>
      )}
      {o && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4" data-admin-overview>
          <Tile icon={ClipboardList} label={t('adminRecords.tiles.issued')} value={o.prescriptions.issued} testId="issued" />
          <Tile icon={ClipboardCheck} label={t('adminRecords.tiles.valid')} value={o.prescriptions.VALID} testId="valid" />
          <Tile icon={ClipboardX} label={t('adminRecords.tiles.cancelledReplaced')} value={`${o.prescriptions.CANCELLED} / ${o.prescriptions.REPLACED}`} testId="cancelled" />
          <Tile icon={ClipboardList} label={t('adminRecords.tiles.last30')} value={o.prescriptions.issuedLast30Days} testId="last30" />
          <Tile icon={FileStack} label={t('adminRecords.tiles.documents')} value={o.documents.active} testId="documents" />
          <Tile icon={Archive} label={t('adminRecords.tiles.archived')} value={o.documents.archived} testId="archived" />
          <Tile icon={HardDrive} label={t('adminRecords.tiles.storage')} value={formatBytes(o.documents.storageBytes)} testId="storage" />
          <Tile icon={ClipboardList} label={t('adminRecords.tiles.drafts')} value={o.prescriptions.DRAFT} testId="drafts" />
        </div>
      )}
      <Card className="p-4 sm:p-6">
        <CardHeader title={t(`adminRecords.tabs.${tab}`)} />
        <Tabs
          className="mb-5 max-w-lg"
          value={tab}
          onChange={setTab}
          items={[
            { value: 'prescriptions', label: t('adminRecords.tabs.prescriptions') },
            { value: 'documents', label: t('adminRecords.tabs.documents') },
            { value: 'audit', label: t('adminRecords.tabs.audit') },
          ]}
        />
        {tab === 'prescriptions' && <PrescriptionsTab />}
        {tab === 'documents' && <DocumentsTab />}
        {tab === 'audit' && <AuditTab />}
      </Card>
    </>
  );
}
