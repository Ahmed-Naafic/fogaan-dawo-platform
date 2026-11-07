import { useState } from 'react';
import { NavLink } from 'react-router';
import { BarChart3, CalendarRange, CreditCard, LayoutDashboard, Settings2, Undo2, Wallet } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Button from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { DemoBanner } from '@/features/payments/pages/CheckoutPage';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { PRESETS } from '../financeUi';

export const FINANCE_LINKS = Object.freeze([
  { to: '/admin/finance', key: 'overview', icon: LayoutDashboard, end: true },
  { to: '/admin/finance/payments', key: 'payments', icon: CreditCard },
  { to: '/admin/finance/refunds', key: 'refunds', icon: Undo2 },
  { to: '/admin/finance/doctor-earnings', key: 'earnings', icon: Wallet },
  { to: '/admin/finance/reports', key: 'reports', icon: BarChart3 },
  { to: '/admin/finance/settings', key: 'settings', icon: Settings2 },
]);

/** Frame shared by every finance screen: header, simulated-payments banner and the finance section links. */
export default function FinanceFrame({ title, subtitle, actions, children }) {
  const { t } = useI18n();
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} back="/admin" />
      <DemoBanner className="mb-4" />
      <nav aria-label={t('finance.nav.label')} className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-1 rounded-xl border border-line bg-surface p-1">
          {FINANCE_LINKS.map(({ to, key, icon: Icon, end }) => (
            <li key={key}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) => cn('flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-colors', isActive ? 'bg-primary text-primary-fg' : 'text-muted hover:bg-subtle hover:text-ink')}
              >
                <Icon className="h-3.5 w-3.5" /> {t(`finance.nav.${key}`)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      {actions && <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">{actions}</div>}
      {children}
    </>
  );
}

/** Date filter: presets plus a custom from/to (inclusive calendar days, admin's time zone). */
export function RangeFilter({ range, onChange }) {
  const { t } = useI18n();
  const [custom, setCustom] = useState({ fromDate: range.fromDate, toDate: range.toDate });
  const choose = (preset) => {
    if (preset !== 'custom') return onChange({ preset });
    const today = new Date().toISOString().slice(0, 10);
    const next = { fromDate: custom.fromDate || today, toDate: custom.toDate || today };
    setCustom(next);
    return onChange({ preset, ...next });
  };
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end" data-range-filter>
      <label className="block">
        <span className="mb-1 flex items-center gap-1 text-2xs font-semibold text-muted">
          <CalendarRange className="h-3.5 w-3.5" /> {t('finance.range.label')}
        </span>
        <Select value={range.preset} onChange={(e) => choose(e.target.value)} className="sm:w-48" name="preset" aria-label={t('finance.range.label')}>
          {PRESETS.map((p) => (
            <option key={p} value={p}>
              {t(`finance.range.${p}`)}
            </option>
          ))}
        </Select>
      </label>
      {range.preset === 'custom' && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onChange({ preset: 'custom', ...custom });
          }}
        >
          <label className="block">
            <span className="mb-1 block text-2xs font-semibold text-muted">{t('finance.range.from')}</span>
            <Input type="date" value={custom.fromDate} onChange={(e) => setCustom((c) => ({ ...c, fromDate: e.target.value }))} name="fromDate" className="w-40" />
          </label>
          <label className="block">
            <span className="mb-1 block text-2xs font-semibold text-muted">{t('finance.range.to')}</span>
            <Input type="date" value={custom.toDate} onChange={(e) => setCustom((c) => ({ ...c, toDate: e.target.value }))} name="toDate" className="w-40" />
          </label>
          <Button type="submit" size="sm" variant="secondary" className="h-11">
            {t('finance.range.apply')}
          </Button>
        </form>
      )}
    </div>
  );
}

/** Loading / error / empty states used by every finance screen. */
export function LoadState({ state, empty, children, height = 'h-48' }) {
  const { t } = useI18n();
  if (state.loading && !state.data) return <div className={cn('card animate-pulse', height)} aria-busy="true" />;
  if (state.error) {
    return (
      <div className="card p-6 text-sm text-danger" role="alert">
        {t(state.error.code === 'FINANCE_RANGE_INVALID' ? 'financeErrors.FINANCE_RANGE_INVALID' : 'financeErrors.GENERIC')}
      </div>
    );
  }
  if (empty) return <div className="card p-8 text-center text-sm text-muted">{empty}</div>;
  return children;
}

export function Pager({ page, pageSize, total, onPage }) {
  const { t } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-muted" data-pager>
      <span>{t('finance.pager', { page, pages, total })}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t('finance.prev')}
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t('finance.next')}
        </Button>
      </div>
    </div>
  );
}
