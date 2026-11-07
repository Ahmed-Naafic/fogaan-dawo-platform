import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Download, X } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { PAYMENT_TONE, PROVIDERS, REFUND_TONE, saveBlob } from '@/features/payments/paymentUi';
import { DemoBanner } from '@/features/payments/pages/CheckoutPage';
import { useI18n } from '@/lib/i18n';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import { financeErrorKey, formatMoney, formatRate } from '../financeUi';
import * as api from '../services/financeApi';

export const providerName = (code) => PROVIDERS.find((p) => p.code === code)?.name ?? code;

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-semibold">{children}</dd>
    </div>
  );
}

/** Side drawer: one payment with appointment, saved commission split, attempts, ledger, refunds and audit history. */
export default function PaymentDetail({ id, onClose }) {
  const { t, locale } = useI18n();
  const notify = useToast();
  const [p, setP] = useState(null);
  useEffect(() => {
    api.payment(id).then(setP).catch((e) => notify(t(financeErrorKey(e)), 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per payment
  }, [id]);
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  const fmt = (iso) => (iso ? formatDateTime(iso, browserTimeZone(), locale) : '—');
  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-labelledby="payment-detail-title">
      <button aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-lg animate-fade-up overflow-y-auto border-l border-line bg-surface p-5 shadow-float sm:p-6" data-payment-detail>
        <div className="mb-4 flex items-start justify-between">
          <h2 id="payment-detail-title" className="text-lg font-extrabold">
            {t('finance.paymentDetail')}
          </h2>
          <button onClick={onClose} className="-mr-2 rounded-lg p-2 text-muted hover:bg-subtle" aria-label={t('common.close')}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <DemoBanner className="mb-4" />
        {!p ? (
          <div className="h-64 animate-pulse rounded-xl bg-subtle" />
        ) : (
          <div className="space-y-5 text-sm">
            <div>
              <p className="flex flex-wrap items-center gap-2 text-xl font-extrabold">
                {formatMoney(p.amount)} <Badge tone={PAYMENT_TONE[p.status]}>{t(`paymentStatus.${p.status}`)}</Badge>
                {p.refundState !== 'NONE' && <Badge tone="purple">{t(`finance.refundState.${p.refundState}`)}</Badge>}
              </p>
              <p className="mt-1 break-all font-mono text-2xs text-muted">{p.reference ?? '—'}</p>
              {p.status === 'SUCCEEDED' && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-3"
                  onClick={async () => {
                    try {
                      saveBlob(await api.receipt(p.id), `fogaan-dawo-demo-receipt-${p.reference}.pdf`);
                    } catch (e) {
                      notify(t(financeErrorKey(e)), 'error');
                    }
                  }}
                >
                  <Download className="h-3.5 w-3.5" /> {t('payments.receipt')}
                </Button>
              )}
            </div>
            <dl className="divide-y divide-line rounded-xl border border-line px-3">
              <Row label={t('finance.col.patient')}>{p.appointment.patient.name}</Row>
              <Row label={t('finance.col.doctor')}>{p.appointment.doctor.name}</Row>
              <Row label={t('finance.col.appointment')}>
                <span className="block">{fmt(p.appointment.startAtUtc)}</span>
                <span className="block font-mono text-2xs font-normal text-muted">{p.appointment.id}</span>
                <span className="block text-2xs font-normal text-muted">{t(`apptStatus.${p.appointment.status}`)}</span>
              </Row>
              <Row label={t('finance.col.method')}>{providerName(p.provider)}</Row>
              <Row label={t('finance.col.paidAt')}>{fmt(p.paidAt)}</Row>
            </dl>
            {p.allocation && (
              <section data-allocation>
                <h3 className="mb-2 font-bold">{t('finance.allocation.title')}</h3>
                <dl className="divide-y divide-line rounded-xl border border-line px-3">
                  <Row label={t('finance.allocation.gross')}>{formatMoney(p.allocation.gross)}</Row>
                  <Row label={t('finance.allocation.rate')}>{formatRate(p.allocation.commissionRate)}</Row>
                  <Row label={t('finance.allocation.commission')}>{formatMoney(p.allocation.commission)}</Row>
                  <Row label={t('finance.allocation.doctor')}>{formatMoney(p.allocation.doctorEarning)}</Row>
                </dl>
                <p className="mt-2 text-2xs text-muted">{t('finance.allocation.note')}</p>
              </section>
            )}
            <section>
              <h3 className="mb-2 font-bold">{t('finance.attempts')}</h3>
              <ul className="space-y-2">
                {p.attempts.map((a) => (
                  <li key={a.number} className="rounded-xl bg-subtle p-3 text-xs">
                    <span className="font-semibold">
                      #{a.number} · {t(`payments.outcome.${a.outcome}`)}
                    </span>{' '}
                    · {providerName(p.provider)} · {a.wallet}
                    <span className="block break-all font-mono text-muted">{a.reference}</span>
                    <span className="block text-muted">
                      {a.message} · {fmt(a.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="mb-2 font-bold">{t('finance.ledger')}</h3>
              {p.ledger.length === 0 ? (
                <p className="text-xs text-muted">{t('finance.noLedger')}</p>
              ) : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {p.ledger.map((e) => (
                    <li key={e.reference} className="flex justify-between gap-3 px-3 py-2 text-xs">
                      <span>{e.kind ? t(`finance.adjustmentKind.${e.kind}`) : t(`finance.ledgerType.${e.type}`)}</span>
                      <span className="font-mono">{formatMoney(e.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {p.refunds.length > 0 && (
              <section>
                <h3 className="mb-2 font-bold">{t('finance.refunds')}</h3>
                <ul className="space-y-2">
                  {p.refunds.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 rounded-xl bg-subtle p-3 text-xs">
                      <Link to={`/admin/finance/refunds?q=${r.id}&preset=all`} className="min-w-0 truncate text-primary hover:underline">
                        {r.reason}
                      </Link>
                      <span className="flex shrink-0 items-center gap-2">
                        {formatMoney(r.amount)} <Badge tone={REFUND_TONE[r.status]}>{t(`refundStatus.${r.status}`)}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h3 className="mb-2 font-bold">{t('finance.audit')}</h3>
              <ol className="space-y-2 border-l-2 border-line pl-4 text-xs">
                {p.audit.map((l, i) => (
                  <li key={i}>
                    <span className="font-semibold">{t(`finance.auditEntity.${l.entity}`)}</span> · {l.details?.outcome ?? l.details?.status ?? l.action}
                    <span className="block text-muted">
                      {l.by} · {fmt(l.at)}
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
