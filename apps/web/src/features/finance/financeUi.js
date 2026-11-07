import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { browserTimeZone } from '@/lib/timezone';

/** Pure helpers and hooks shared by the admin finance screens. */

export const PRESETS = Object.freeze(['today', '7d', '30d', 'month', 'all', 'custom']);
export const REFUND_STATUSES = Object.freeze(['REQUESTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REJECTED']);
export const PAYMENT_STATUSES = Object.freeze(['SUCCEEDED', 'PENDING', 'FAILED', 'CANCELLED']);
export const REFUND_STATE_TONE = Object.freeze({ NONE: 'neutral', REQUESTED: 'gold', PARTIAL: 'blue', FULL: 'purple' });

/** "$1,234.50" — amounts arrive from the server as exact 2-decimal strings. */
export function formatMoney(value) {
  const n = Number(value ?? 0);
  return `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "0.1500" → "15%" / "12.5%". */
export const formatRate = (fraction) => (fraction == null ? '—' : `${Number((Number(fraction) * 100).toFixed(2))}%`);

/** Date range kept in the URL (?preset=…&fromDate=…&toDate=…) so filters survive reloads and links. */
export function useFinanceRange(defaultPreset = '30d') {
  const [params, setParams] = useSearchParams();
  const preset = PRESETS.includes(params.get('preset')) ? params.get('preset') : defaultPreset;
  const fromDate = params.get('fromDate') ?? '';
  const toDate = params.get('toDate') ?? '';
  const tz = browserTimeZone();
  const query = useMemo(() => (preset === 'custom' ? { preset, fromDate, toDate, tz } : { preset, tz }), [preset, fromDate, toDate, tz]);
  const setRange = useCallback(
    (next) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          for (const k of ['preset', 'fromDate', 'toDate', 'page']) p.delete(k);
          p.set('preset', next.preset);
          if (next.preset === 'custom') {
            p.set('fromDate', next.fromDate);
            p.set('toDate', next.toDate);
          }
          return p;
        },
        { replace: true },
      ),
    [setParams],
  );
  return { range: { preset, fromDate, toDate }, query, setRange };
}

/** Loads `fn()` whenever `deps` change, with loading / error states; `reload()` re-runs it. */
export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn()
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error, loading: false }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- explicit dependency list
  }, [...deps, tick]);
  return { ...state, reload: useCallback(() => setTick((n) => n + 1), []) };
}

const FINANCE_CODES = new Set(['FINANCE_RANGE_INVALID', 'COMMISSION_INVALID', 'COMMISSION_UNCHANGED', 'REFUND_NOT_REVIEWABLE', 'REFUND_NOT_REQUESTED', 'REFUND_NOT_FAILED', 'VALIDATION_ERROR', 'RATE_LIMITED', 'NETWORK_ERROR', 'NOT_FOUND']);
export const financeErrorKey = (error) => `financeErrors.${FINANCE_CODES.has(error?.code) ? error.code : 'GENERIC'}`;

/** Debounced value (search boxes). */
export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}
