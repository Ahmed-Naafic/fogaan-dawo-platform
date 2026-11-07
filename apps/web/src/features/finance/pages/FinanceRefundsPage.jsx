import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { CheckCircle2, History, RefreshCw, Search, X, XCircle } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { Dialog } from '@/features/appointments/components/AppointmentDialogs';
import { REFUND_TONE } from '@/features/payments/paymentUi';
import { DemoBanner } from '@/features/payments/pages/CheckoutPage';
import { useI18n } from '@/lib/i18n';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import FinanceFrame, { LoadState, Pager, RangeFilter } from '../components/FinanceFrame';
import { providerName } from '../components/PaymentDetail';
import { financeErrorKey, formatMoney, REFUND_STATUSES, useDebounced, useFinanceRange, useLoad } from '../financeUi';
import * as api from '../services/financeApi';

const PAGE_SIZE = 20;

/** Approve (simulated payout) — confirms the exact amount first. */
function ApproveDialog({ refund, busy, onClose, onConfirm }) {
  const { t } = useI18n();
  return (
    <Dialog title={t('finance.review.approveTitle')} onClose={onClose} busy={busy} labelledBy="approve-title">
      <p className="text-sm">{t('finance.review.approveBody', { amount: formatMoney(refund.amount), patient: refund.patient.name, method: providerName(refund.provider) })}</p>
      <p className="mt-2 text-xs text-muted">{t('finance.review.simulated')}</p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button onClick={onConfirm} disabled={busy} data-confirm-approve>
          <CheckCircle2 className="h-4 w-4" /> {t('finance.review.approve')}
        </Button>
      </div>
    </Dialog>
  );
}

/** Reject — a reason of at least 10 characters is required and recorded. */
function RejectDialog({ refund, busy, onClose, onConfirm }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  const [error, setError] = useState(false);
  return (
    <Dialog title={t('finance.review.rejectTitle')} onClose={onClose} busy={busy} labelledBy="reject-title">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim().length < 10) return setError(true);
          return onConfirm(reason.trim());
        }}
      >
        <p className="text-sm">{t('finance.review.rejectBody', { amount: formatMoney(refund.amount), patient: refund.patient.name })}</p>
        <label htmlFor="reject-reason" className="mb-1.5 mt-4 block text-xs font-semibold text-muted">
          {t('finance.review.reason')}
        </label>
        <Textarea id="reject-reason" rows={3} maxLength={500} value={reason} onChange={(e) => (setReason(e.target.value), setError(false))} aria-invalid={error} />
        {error && (
          <p className="mt-1 text-xs text-danger" role="alert">
            {t('finance.review.reasonShort')}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="danger" disabled={busy} data-confirm-reject>
            <XCircle className="h-4 w-4" /> {t('finance.review.reject')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Drawer: refund, original payment, appointment and the decision history. */
function RefundDetail({ id, onClose }) {
  const { t, locale } = useI18n();
  const [r, setR] = useState(null);
  useEffect(() => {
    api.refund(id).then(setR).catch(() => setR(false));
  }, [id]);
  const fmt = (iso) => (iso ? formatDateTime(iso, browserTimeZone(), locale) : '—');
  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-labelledby="refund-detail-title">
      <button aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-lg animate-fade-up overflow-y-auto border-l border-line bg-surface p-5 shadow-float sm:p-6" data-refund-detail>
        <div className="mb-4 flex items-start justify-between">
          <h2 id="refund-detail-title" className="text-lg font-extrabold">
            {t('finance.review.detailTitle')}
          </h2>
          <button onClick={onClose} className="-mr-2 rounded-lg p-2 text-muted hover:bg-subtle" aria-label={t('common.close')}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <DemoBanner className="mb-4" />
        {r === null && <div className="h-64 animate-pulse rounded-xl bg-subtle" />}
        {r === false && <p className="text-sm text-danger">{t('financeErrors.GENERIC')}</p>}
        {r && (
          <div className="space-y-5 text-sm">
            <p className="flex flex-wrap items-center gap-2 text-xl font-extrabold">
              {formatMoney(r.amount)} <Badge tone={REFUND_TONE[r.status]}>{t(`refundStatus.${r.status}`)}</Badge>
            </p>
            <dl className="divide-y divide-line rounded-xl border border-line px-3 text-xs">
              {[
                ['finance.col.patient', r.patient.name],
                ['finance.col.doctor', r.doctor.name],
                ['finance.col.appointment', `${fmt(r.appointment.startAtUtc)} · ${t(`apptStatus.${r.appointment.status}`)}`],
                ['finance.review.originalPayment', `${formatMoney(r.payment.amount)} · ${providerName(r.payment.provider)} · ${fmt(r.payment.paidAt)}`],
                ['finance.review.refundable', formatMoney(r.payment.refundable)],
                ['finance.review.requested', fmt(r.createdAt)],
                ['finance.review.processed', fmt(r.processedAt)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 py-2">
                  <dt className="text-muted">{t(label)}</dt>
                  <dd className="text-right font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            <div>
              <h3 className="mb-1 font-bold">{t('finance.review.reasonRequested')}</h3>
              <p className="text-muted">{r.reason}</p>
            </div>
            {r.review?.note && (
              <div>
                <h3 className="mb-1 font-bold">{t('finance.review.reasonRejected')}</h3>
                <p className="text-muted">{r.review.note}</p>
              </div>
            )}
            <section>
              <h3 className="mb-2 font-bold">{t('finance.review.history')}</h3>
              <ol className="space-y-2 border-l-2 border-line pl-4 text-xs">
                {r.history.map((h, i) => (
                  <li key={i}>
                    <span className="font-semibold">{t(`refundStatus.${h.status}`)}</span>
                    {h.reason && <span className="block text-muted">{h.reason}</span>}
                    <span className="block text-muted">
                      {h.by} · {fmt(h.at)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/** /admin/finance/refunds — review queue: approve (simulated), reject with a reason, retry failed, history. */
export default function FinanceRefundsPage() {
  const { t, locale } = useI18n();
  const notify = useToast();
  const [params, setParams] = useSearchParams();
  const { range, query, setRange } = useFinanceRange('all');
  const [term, setTerm] = useState(params.get('q') ?? '');
  const q = useDebounced(term.trim());
  const status = params.get('status') ?? 'REQUESTED';
  const page = Number(params.get('page') ?? 1) || 1;
  const [dialog, setDialog] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const setParam = (key, value) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set(key, value);
        if (key !== 'page') p.delete('page');
        return p;
      },
      { replace: true },
    );
  const state = useLoad(() => api.refunds({ ...(query.preset === 'all' ? {} : query), status: status === 'ALL' ? '' : status, q, page, pageSize: PAGE_SIZE }), [query, status, q, page]);
  const data = state.data;
  const fmt = (iso) => (iso ? formatDateTime(iso, browserTimeZone(), locale) : '—');

  const decide = async (fn, success, tone) => {
    setBusy(true);
    try {
      const result = await fn();
      notify(typeof success === 'function' ? success(result) : success, typeof tone === 'function' ? tone(result) : tone);
      setDialog(null);
    } catch (error) {
      notify(t(financeErrorKey(error)), 'error');
    } finally {
      setBusy(false);
      state.reload();
    }
  };

  return (
    <FinanceFrame title={t('finance.titles.refunds')} subtitle={t('finance.subtitles.refunds')} actions={<RangeFilter range={range} onChange={setRange} />}>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row">
        <Input icon={Search} value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('finance.searchRefunds')} aria-label={t('common.search')} className="flex-1" name="refundQ" />
        <Select value={status} onChange={(e) => setParam('status', e.target.value)} className="lg:w-56" aria-label={t('finance.status')} name="refundStatus">
          <option value="ALL">{t('finance.allStatuses')}</option>
          {REFUND_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`finance.refundFilter.${s}`)}
            </option>
          ))}
        </Select>
      </div>
      <LoadState state={state} empty={data && data.items.length === 0 ? t('finance.noRefunds') : null}>
        {data && (
          <>
            <ul className="grid gap-3 lg:grid-cols-2" aria-label={t('finance.refunds')}>
              {data.items.map((r) => (
                <li key={r.id} className="card p-4" data-refund={r.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold">{r.patient.name}</p>
                      <p className="text-xs text-muted">
                        {r.appointment.doctor.name} · {fmt(r.appointment.startAtUtc)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-extrabold">{formatMoney(r.amount)}</p>
                      <Badge tone={REFUND_TONE[r.status]}>{t(`refundStatus.${r.status}`)}</Badge>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-muted">{r.reason}</p>
                  <p className="mt-1 text-2xs text-muted">
                    {t('finance.ofPayment', { amount: formatMoney(r.paymentAmount), method: providerName(r.provider) })} · {t('finance.review.requestedOn', { date: fmt(r.createdAt) })}
                    {r.processedAt ? ` · ${t('finance.review.processedOn', { date: fmt(r.processedAt) })}` : ''}
                  </p>
                  {r.review?.note && <p className="mt-1 text-2xs text-muted">{t('finance.review.rejectedBecause', { reason: r.review.note, by: r.review.by })}</p>}
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setDetail(r.id)} data-refund-history>
                      <History className="h-3.5 w-3.5" /> {t('finance.review.history')}
                    </Button>
                    {r.status === 'REQUESTED' && (
                      <>
                        <Button size="sm" variant="secondary" className="text-danger" onClick={() => setDialog({ kind: 'reject', refund: r })} data-reject-refund>
                          <XCircle className="h-3.5 w-3.5" /> {t('finance.review.reject')}
                        </Button>
                        <Button size="sm" onClick={() => setDialog({ kind: 'approve', refund: r })} data-approve-refund>
                          <CheckCircle2 className="h-3.5 w-3.5" /> {t('finance.review.approve')}
                        </Button>
                      </>
                    )}
                    {r.status === 'FAILED' && (
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => decide(() => api.retryRefund(r.id), t('finance.refundRetried'))}>
                        <RefreshCw className="h-3.5 w-3.5" /> {t('finance.retryRefund')}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={(n) => setParam('page', String(n))} />
          </>
        )}
      </LoadState>
      {dialog?.kind === 'approve' && (
        <ApproveDialog
          refund={dialog.refund}
          busy={busy}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            decide(
              () => api.approveRefund(dialog.refund.id),
              (res) => t(res.outcome === 'SUCCESS' ? 'finance.refundDone' : 'finance.refundFailed', { amount: formatMoney(dialog.refund.amount) }),
              (res) => (res.outcome === 'SUCCESS' ? 'success' : 'error'),
            )
          }
        />
      )}
      {dialog?.kind === 'reject' && <RejectDialog refund={dialog.refund} busy={busy} onClose={() => setDialog(null)} onConfirm={(reason) => decide(() => api.rejectRefund(dialog.refund.id, reason), t('finance.review.rejected'), 'success')} />}
      {detail && <RefundDetail id={detail} onClose={() => setDetail(null)} />}
    </FinanceFrame>
  );
}
