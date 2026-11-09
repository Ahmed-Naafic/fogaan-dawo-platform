import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ChevronDown, Info, Search, X } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Badge from '@/components/ui/Badge';
import Card from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { LoadState, Pager, RangeFilter } from '@/features/finance/components/FinanceFrame';
import { useDebounced, useFinanceRange, useLoad } from '@/features/finance/financeUi';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import * as api from '../services/adminConsoleApi';

export const AUDIT_ACTIONS = Object.freeze(['CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'VERIFY', 'SUSPEND', 'REFUND', 'RESCHEDULE', 'OTHER']);
const ACTION_TONE = Object.freeze({ CREATE: 'green', UPDATE: 'blue', DELETE: 'red', LOGIN: 'teal', LOGOUT: 'neutral', VERIFY: 'green', SUSPEND: 'red', REFUND: 'purple', RESCHEDULE: 'gold', OTHER: 'neutral' });
const PAGE_SIZE = 25;

function Values({ label, values }) {
  if (!values) return null;
  return (
    <div className="min-w-0">
      <p className="mb-1 text-2xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {Object.entries(values).map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-muted">{k}</dt>
            <dd className="break-all font-mono">{String(v)}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

/** Admin › Audit logs — platform events (no clinical records), filterable, each row expandable. */
export default function AdminAuditLogsPage() {
  const { t, locale } = useI18n();
  const tz = browserTimeZone();
  const [params, setParams] = useSearchParams();
  const { range, query, setRange } = useFinanceRange('7d');
  const action = AUDIT_ACTIONS.includes(params.get('action')) ? params.get('action') : '';
  const entityType = params.get('entityType') ?? '';
  const actorUserId = params.get('actorUserId') ?? '';
  const [term, setTerm] = useState(params.get('q') ?? '');
  const q = useDebounced(term.trim());
  const page = Number(params.get('page') ?? 1) || 1;
  const [open, setOpen] = useState(null);
  const state = useLoad(() => api.listAuditLogs({ ...query, action, entityType, actorUserId, q, page, pageSize: PAGE_SIZE }), [query, action, entityType, actorUserId, q, page]);
  const data = state.data;
  const set = (key, value) => setParams((p) => (p.delete('page'), value ? p.set(key, value) : p.delete(key), p), { replace: true });

  return (
    <>
      <PageHeader title={t('adminAudit.title')} subtitle={t('adminAudit.subtitle')} back="/admin" />
      <p className="mb-4 flex items-start gap-2 rounded-xl border border-line bg-subtle px-4 py-3 text-xs text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0" /> {t('adminAudit.clinicalNote')}
      </p>
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end">
        <RangeFilter range={range} onChange={setRange} />
        <label className="block">
          <span className="mb-1 block text-2xs font-semibold text-muted">{t('adminAudit.action')}</span>
          <Select value={action} onChange={(e) => set('action', e.target.value)} className="xl:w-40" name="action" aria-label={t('adminAudit.action')}>
            <option value="">{t('adminAudit.allActions')}</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {t(`auditAction.${a}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1 block text-2xs font-semibold text-muted">{t('adminAudit.entity')}</span>
          <Select value={entityType} onChange={(e) => set('entityType', e.target.value)} className="xl:w-52" name="entityType" aria-label={t('adminAudit.entity')}>
            <option value="">{t('adminAudit.allEntities')}</option>
            {(data?.entityTypes ?? (entityType ? [entityType] : [])).map((e) => (
              <option key={e} value={e}>
                {e}
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
          placeholder={t('adminAudit.search')}
          aria-label={t('common.search')}
          className="xl:ml-auto xl:w-64"
          name="q"
        />
      </div>
      {actorUserId && (
        <p className="mb-4">
          <button type="button" onClick={() => set('actorUserId', '')} className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary">
            {t('adminAudit.oneActor')} <X className="h-3.5 w-3.5" />
          </button>
        </p>
      )}
      <LoadState state={state} empty={data && data.items.length === 0 ? t('adminAudit.empty') : null}>
        {data && (
          <>
            <Card className="divide-y divide-line" data-audit-list>
              {data.items.map((e) => {
                const expandable = Boolean(e.oldValues || e.newValues);
                const isOpen = open === e.id;
                return (
                  <div key={e.id} data-audit-row={e.id}>
                    <button
                      type="button"
                      disabled={!expandable}
                      onClick={() => setOpen(isOpen ? null : e.id)}
                      aria-expanded={expandable ? isOpen : undefined}
                      className={cn('flex w-full items-center gap-3 px-4 py-3 text-left text-sm', expandable && 'hover:bg-subtle/50')}
                    >
                      <Badge tone={ACTION_TONE[e.action] ?? 'neutral'} className="w-24 justify-center">
                        {t(`auditAction.${e.action}`)}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">
                          {e.entityType}
                          {e.entityRef && <span className="ml-1.5 font-mono text-2xs font-normal text-muted">#{e.entityRef}</span>}
                        </p>
                        <p className="truncate text-xs text-muted">
                          {e.actor ? `${e.actor.name} · ${t(`roles.${e.actor.role.toLowerCase()}`)}` : t('adminAudit.system')} · {formatDateTime(e.at, tz, locale)}
                        </p>
                      </div>
                      {expandable && <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted transition-transform', isOpen && 'rotate-180')} />}
                    </button>
                    {isOpen && (
                      <div className="grid gap-4 bg-subtle/40 px-4 py-3 sm:grid-cols-2">
                        <Values label={t('adminAudit.before')} values={e.oldValues} />
                        <Values label={t('adminAudit.after')} values={e.newValues} />
                      </div>
                    )}
                  </div>
                );
              })}
            </Card>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(n) => setParams((p) => (p.set('page', String(n)), p), { replace: true })} />
          </>
        )}
      </LoadState>
    </>
  );
}
