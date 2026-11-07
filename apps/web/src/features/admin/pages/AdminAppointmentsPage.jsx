import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Search } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Card from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { AppointmentStatusBadge } from '@/features/appointments/components/AppointmentParts';
import { specialtyName } from '@/features/doctors/doctorApplicationForm';
import { LoadState, Pager, RangeFilter } from '@/features/finance/components/FinanceFrame';
import { formatMoney, useDebounced, useFinanceRange, useLoad } from '@/features/finance/financeUi';
import { useI18n } from '@/lib/i18n';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import * as api from '../services/adminConsoleApi';

export const APPOINTMENT_STATUSES = Object.freeze(['PENDING_PAYMENT', 'CONFIRMED', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'RESCHEDULED', 'NO_SHOW']);
const PAGE_SIZE = 20;

/** Admin › Appointments — every booking, filtered by start date, status and patient/doctor name. Read-only. */
export default function AdminAppointmentsPage() {
  const { t, lang, locale } = useI18n();
  const tz = browserTimeZone();
  const [params, setParams] = useSearchParams();
  const { range, query, setRange } = useFinanceRange('all');
  const status = APPOINTMENT_STATUSES.includes(params.get('status')) ? params.get('status') : '';
  const [term, setTerm] = useState(params.get('q') ?? '');
  const q = useDebounced(term.trim());
  const page = Number(params.get('page') ?? 1) || 1;
  const state = useLoad(() => api.listAppointments({ ...query, status, q, page, pageSize: PAGE_SIZE }), [query, status, q, page]);
  const data = state.data;
  const set = (key, value) => setParams((p) => (p.delete('page'), value ? p.set(key, value) : p.delete(key), p), { replace: true });

  return (
    <>
      <PageHeader title={t('adminAppointments.title')} subtitle={t('adminAppointments.subtitle')} back="/admin" />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end">
        <RangeFilter range={range} onChange={setRange} />
        <label className="block">
          <span className="mb-1 block text-2xs font-semibold text-muted">{t('adminAppointments.status')}</span>
          <Select value={status} onChange={(e) => set('status', e.target.value)} className="lg:w-52" name="status" aria-label={t('adminAppointments.status')}>
            <option value="">{t('adminAppointments.allStatuses')}</option>
            {APPOINTMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`apptStatus.${s}`)}
                {data?.statusCounts ? ` (${data.statusCounts[s] ?? 0})` : ''}
              </option>
            ))}
          </Select>
        </label>
        <Input
          icon={Search}
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            set('q', e.target.value.trim());
          }}
          placeholder={t('adminAppointments.search')}
          aria-label={t('common.search')}
          className="lg:ml-auto lg:w-72"
          name="q"
        />
      </div>
      <LoadState state={state} empty={data && data.items.length === 0 ? t('adminAppointments.empty') : null}>
        {data && (
          <>
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm" data-admin-appointments>
                <thead className="border-b border-line bg-subtle/60 text-left text-2xs font-bold uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2.5">{t('adminAppointments.col.when')}</th>
                    <th className="px-3 py-2.5">{t('adminAppointments.col.patient')}</th>
                    <th className="px-3 py-2.5">{t('adminAppointments.col.doctor')}</th>
                    <th className="px-3 py-2.5 text-right">{t('adminAppointments.col.fee')}</th>
                    <th className="px-4 py-2.5">{t('adminAppointments.status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.items.map((a) => (
                    <tr key={a.id} className="hover:bg-subtle/50" data-admin-appointment={a.id}>
                      <td className="px-4 py-3">
                        <Link to={`/admin/appointments/${a.id}`} className="font-semibold hover:text-primary">
                          {formatDateTime(a.startAtUtc, tz, locale)}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <Link to={`/admin/patients/${a.patient.id}`} className="hover:text-primary">
                          {a.patient.name}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <p>{a.doctor.name}</p>
                        <p className="text-2xs text-muted">{specialtyName(a.doctor.specialty, lang)}</p>
                      </td>
                      <td className="px-3 py-3 text-right">{formatMoney(a.fee)}</td>
                      <td className="px-4 py-3">
                        <AppointmentStatusBadge status={a.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(n) => setParams((p) => (p.set('page', String(n)), p), { replace: true })} />
          </>
        )}
      </LoadState>
    </>
  );
}
