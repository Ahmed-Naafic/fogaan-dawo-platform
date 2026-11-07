import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ChevronRight, ClipboardList } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Tabs from '@/components/ui/Tabs';
import { useI18n } from '@/lib/i18n';
import { RxStatusBadge } from '../components/RxParts';
import { listDoctorPrescriptions, listMyPrescriptions } from '../services/prescriptionApi';

const fmt = (iso, locale) => (iso ? new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

/** /patient/prescriptions and /doctor/prescriptions — history with status filter; never editable here. */
export default function PrescriptionsListPage({ viewer }) {
  const { t, locale } = useI18n();
  const isDoctor = viewer === 'DOCTOR';
  const base = isDoctor ? '/doctor/prescriptions' : '/patient/prescriptions';
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(undefined);
  const latest = useRef(0); // ignore responses of superseded filter/page requests

  const load = useCallback(() => {
    const id = (latest.current += 1);
    setData(undefined);
    (isDoctor ? listDoctorPrescriptions : listMyPrescriptions)({ status: status || undefined, page })
      .then((d) => id === latest.current && setData(d))
      .catch(() => id === latest.current && setData(null));
  }, [isDoctor, status, page]);
  useEffect(load, [load]);

  const filters = [
    { value: '', label: t('rx.filters.all') },
    ...(isDoctor ? [{ value: 'DRAFT', label: t('rx.status.DRAFT') }] : []),
    { value: 'VALID', label: t('rx.status.VALID') },
    { value: 'CANCELLED', label: t('rx.status.CANCELLED') },
    { value: 'REPLACED', label: t('rx.status.REPLACED') },
  ];
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader title={t('rx.title')} subtitle={t(isDoctor ? 'rx.subtitleDoctor' : 'rx.subtitlePatient')} />
      <Tabs
        items={filters}
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        className="mb-5 max-w-xl"
      />
      {data === undefined && (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-20 animate-pulse" />
          ))}
        </div>
      )}
      {data === null && (
        <Card className="p-6 text-center" role="alert">
          <p className="text-sm text-muted">{t('rx.loadFailed')}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={load}>
            {t('profile.retry')}
          </Button>
        </Card>
      )}
      {data && data.items.length === 0 && (
        <Card className="flex flex-col items-center px-6 py-12 text-center" data-rx-list-empty>
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <ClipboardList className="h-6 w-6" />
          </span>
          <p className="mt-3 text-sm font-semibold text-ink">{t(isDoctor ? 'rx.listEmptyDoctor' : 'rx.listEmptyPatient')}</p>
          <p className="mt-1 max-w-sm text-xs text-muted">{t(isDoctor ? 'rx.listEmptyDoctorHint' : 'rx.listEmptyPatientHint')}</p>
        </Card>
      )}
      {data && data.items.length > 0 && (
        <ul className="space-y-3" data-rx-list>
          {data.items.map((rx) => (
            <li key={rx.id}>
              <Link to={`${base}/${rx.id}`} className="card flex items-center gap-3.5 p-4 transition-shadow hover:shadow-float" data-rx-list-item={rx.status}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <ClipboardList className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2 text-[15px] font-bold text-ink">
                    {rx.reference ?? t('rx.draftTitle')}
                    <RxStatusBadge status={rx.status} />
                  </span>
                  <span className="block truncate text-sm text-muted">{isDoctor ? rx.patient.name : rx.doctor.name}</span>
                  <span className="block text-xs text-muted">
                    {rx.issuedAt ? t('rx.issuedOn', { date: fmt(rx.issuedAt, locale) }) : t('rx.createdOn', { date: fmt(rx.createdAt, locale) })} · {t('rx.itemCount', { count: rx.itemCount })}
                  </span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data && pages > 1 && (
        <div className="mt-5 flex items-center justify-center gap-3 text-sm">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('rx.prev')}
          </Button>
          <span className="text-muted">{t('rx.pageOf', { page, pages })}</span>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {t('rx.next')}
          </Button>
        </div>
      )}
    </>
  );
}
