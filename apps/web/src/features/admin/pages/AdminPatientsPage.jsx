import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronRight, Search, Users } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import Tabs from '@/components/ui/Tabs';
import { Pager } from '@/features/finance/components/FinanceFrame';
import { formatMoney, useDebounced, useLoad } from '@/features/finance/financeUi';
import { useI18n } from '@/lib/i18n';
import { adminConsoleErrorKey } from '../services/adminConsoleApi';
import * as api from '../services/adminConsoleApi';

export const PATIENT_TABS = Object.freeze(['all', 'active', 'suspended']);
export const ACCOUNT_TONE = Object.freeze({ ACTIVE: 'green', SUSPENDED: 'red', DISABLED: 'neutral', PENDING_VERIFICATION: 'gold' });
const PAGE_SIZE = 20;

/** Admin › Patients — patient accounts with status, appointments and amount paid. No clinical data. */
export default function AdminPatientsPage() {
  const { t, locale } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab = PATIENT_TABS.includes(params.get('tab')) ? params.get('tab') : 'all';
  const [term, setTerm] = useState(params.get('q') ?? '');
  const q = useDebounced(term.trim());
  const page = Number(params.get('page') ?? 1) || 1;
  const state = useLoad(() => api.listPatients({ tab, q, page, pageSize: PAGE_SIZE }), [tab, q, page]);
  const data = state.data;
  const fmt = (d) => (d ? new Date(d).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
  const set = (key, value) => setParams((p) => (p.delete('page'), value && value !== 'all' ? p.set(key, value) : p.delete(key), p), { replace: true });

  return (
    <>
      <PageHeader title={t('adminPatients.title')} subtitle={t('adminPatients.subtitle')} back="/admin" />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Tabs
          className="max-w-md"
          value={tab}
          onChange={(v) => set('tab', v)}
          items={PATIENT_TABS.map((name) => ({ value: name, label: t(`adminPatients.tabs.${name}`, { count: data?.counts?.[name] ?? '…' }) }))}
        />
        <Input
          icon={Search}
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            set('q', e.target.value.trim());
          }}
          placeholder={t('adminPatients.search')}
          aria-label={t('common.search')}
          className="lg:ml-auto lg:w-80"
          name="q"
        />
      </div>
      <div className="mt-5">
        {state.loading && !data ? (
          <div className="grid gap-3 lg:grid-cols-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card h-28 animate-pulse" />
            ))}
          </div>
        ) : state.error ? (
          <div className="card p-6 text-sm text-danger" role="alert">
            {t(adminConsoleErrorKey(state.error))}
          </div>
        ) : data.items.length === 0 ? (
          <div className="card flex flex-col items-center px-6 py-14 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <Users className="h-7 w-7" />
            </span>
            <p className="mt-4 text-sm text-muted">{t(q ? 'adminPatients.noMatch' : 'adminPatients.empty')}</p>
          </div>
        ) : (
          <>
            <ul className="grid gap-3 lg:grid-cols-2" aria-label={t('adminPatients.title')}>
              {data.items.map((p) => (
                <li key={p.patientId}>
                  <Link to={`/admin/patients/${p.patientId}`} className="card flex items-center gap-3.5 p-4 transition-shadow hover:shadow-float" data-admin-patient={p.patientId}>
                    <Avatar name={p.name} size="lg" className="ring-2 ring-primary-soft" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-[15px] font-bold">
                        <span className="truncate">{p.name}</span>
                        <Badge tone={ACCOUNT_TONE[p.status] ?? 'neutral'}>{t(`accountStatus.${p.status}`)}</Badge>
                      </p>
                      <p className="truncate text-xs text-muted">{[p.email, p.phone].filter(Boolean).join(' · ') || '—'}</p>
                      <p className="mt-1 text-xs text-muted">
                        {t('adminPatients.rowFacts', { appointments: p.appointments, paid: formatMoney(p.totalPaid), joined: fmt(p.registeredAt) })}
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(n) => setParams((p) => (p.set('page', String(n)), p), { replace: true })} />
          </>
        )}
      </div>
    </>
  );
}
