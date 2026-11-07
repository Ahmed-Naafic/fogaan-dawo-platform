import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { CalendarClock, ChevronRight, History, Search, Users } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Avatar from '@/components/ui/Avatar';
import { Input } from '@/components/ui/Input';
import { Pager } from '@/features/finance/components/FinanceFrame';
import { useDebounced, useLoad } from '@/features/finance/financeUi';
import usePrivateImage from '@/features/profile/usePrivateImage';
import { useI18n } from '@/lib/i18n';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import * as api from '../services/doctorWorkspaceApi';

const PAGE_SIZE = 20;

function PatientRow({ item }) {
  const { t, locale } = useI18n();
  const tz = browserTimeZone();
  const photo = usePrivateImage(item.photoUrl);
  return (
    <Link to={`/doctor/patients/${item.id}`} className="card flex items-center gap-3.5 p-4 transition-shadow hover:shadow-float" data-patient-row={item.id}>
      <Avatar src={photo} name={item.name} size="lg" className="ring-2 ring-primary-soft" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold">{item.name}</p>
        <p className="text-xs text-muted">{t('myPatients.visits', { count: item.completedConsultations, total: item.appointments })}</p>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {item.nextVisitAt && (
            <span className="inline-flex items-center gap-1 font-semibold text-primary">
              <CalendarClock className="h-3.5 w-3.5" /> {t('myPatients.next', { when: formatDateTime(item.nextVisitAt, tz, locale) })}
            </span>
          )}
          {item.lastVisitAt && (
            <span className="inline-flex items-center gap-1">
              <History className="h-3.5 w-3.5" /> {t('myPatients.last', { when: formatDateTime(item.lastVisitAt, tz, locale) })}
            </span>
          )}
        </div>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
    </Link>
  );
}

/** /doctor/patients — patients with at least one paid appointment with this doctor. */
export default function DoctorPatientsPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState(params.get('q') ?? '');
  const q = useDebounced(term.trim());
  const page = Number(params.get('page') ?? 1) || 1;
  const state = useLoad(() => api.listMyPatients({ q, page, pageSize: PAGE_SIZE }), [q, page]);
  const data = state.data;

  const onSearch = (value) => {
    setTerm(value);
    setParams((p) => (p.delete('page'), value.trim() ? p.set('q', value.trim()) : p.delete('q'), p), { replace: true });
  };

  return (
    <>
      <PageHeader title={t('myPatients.title')} subtitle={t('myPatients.subtitle')} back="/doctor" />
      <Input icon={Search} value={term} onChange={(e) => onSearch(e.target.value)} placeholder={t('myPatients.search')} aria-label={t('common.search')} className="mb-5 max-w-md" name="q" />
      {state.loading && !data ? (
        <div className="grid gap-3 lg:grid-cols-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card h-[92px] animate-pulse" />
          ))}
        </div>
      ) : state.error ? (
        <div className="card p-6 text-sm text-danger" role="alert">
          {t(state.error.code === 'DOCTOR_NOT_ACTIVE' ? 'myPatients.inactive' : 'myPatients.error')}
        </div>
      ) : data.items.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Users className="h-7 w-7" />
          </span>
          <p className="mt-4 max-w-sm text-sm text-muted">{t(q ? 'myPatients.noMatch' : 'myPatients.empty')}</p>
        </div>
      ) : (
        <>
          <ul className="grid gap-3 lg:grid-cols-2" aria-label={t('myPatients.title')}>
            {data.items.map((item) => (
              <li key={item.id}>
                <PatientRow item={item} />
              </li>
            ))}
          </ul>
          <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(n) => setParams((p) => (p.set('page', String(n)), p), { replace: true })} />
        </>
      )}
    </>
  );
}
