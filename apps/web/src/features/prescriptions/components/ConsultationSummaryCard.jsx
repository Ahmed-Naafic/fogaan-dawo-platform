import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ChevronRight, Eye, EyeOff, Lock, NotebookText } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { useI18n } from '@/lib/i18n';
import { getConsultationSummary } from '../services/prescriptionApi';
import { RxStatusBadge } from './RxParts';

/**
 * Consultation summary. Patient: only the sections the doctor shared + prescriptions from this
 * consultation. Doctor: every section with its share state. It is a consultation record — not part of the
 * patient's long-term medical history.
 */
export default function ConsultationSummaryCard({ consultationId, role, refreshKey }) {
  const { t, locale } = useI18n();
  const isDoctor = role === 'DOCTOR';
  const [data, setData] = useState(undefined);
  const load = useCallback(() => {
    if (!consultationId) return;
    getConsultationSummary(consultationId)
      .then(setData)
      .catch(() => setData(null));
  }, [consultationId]);
  useEffect(load, [load, refreshKey]);

  const title = (
    <h3 className="mb-1 flex items-center gap-2 text-base font-bold sm:text-[17px]">
      <NotebookText className="h-4 w-4 text-primary" /> {t('summary.title')}
    </h3>
  );
  if (data === undefined) return <section aria-busy="true">{title}<div className="h-20 animate-pulse rounded-xl bg-subtle" /></section>;
  if (data === null) {
    return (
      <section>
        {title}
        <p className="text-sm text-muted">{t('summary.loadFailed')}</p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={load}>
          {t('profile.retry')}
        </Button>
      </section>
    );
  }

  const visible = isDoctor ? data.sections.filter((s) => s.text) : data.sections;
  return (
    <section data-consultation-summary>
      {title}
      <p className="mb-4 text-xs text-muted">{isDoctor ? t('summary.doctorHint') : t('summary.patientHint')}</p>
      {!data.available && !isDoctor ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-sm text-muted">{t('summary.notYet')}</p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-sm text-muted" data-summary-empty>
          {isDoctor ? t('summary.emptyDoctor') : t('summary.emptyPatient')}
        </p>
      ) : (
        <dl className="space-y-3">
          {visible.map((s) => (
            <div key={s.key} className="rounded-xl bg-subtle/70 p-3.5" data-summary-section={s.key}>
              <dt className="flex items-center gap-2 text-2xs font-bold uppercase tracking-wider text-muted">
                {t(`consult.noteFields.${s.key}`)}
                {isDoctor && (
                  <Badge tone={s.shared ? 'teal' : 'neutral'} icon={s.shared ? Eye : EyeOff}>
                    {t(s.shared ? 'summary.shared' : 'summary.private')}
                  </Badge>
                )}
              </dt>
              <dd className="mt-1 whitespace-pre-line break-words text-sm text-ink">{s.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {isDoctor && data.notesLockedAt && (
        <p className="mt-3 flex items-center gap-1.5 text-2xs text-muted">
          <Lock className="h-3 w-3" /> {t('summary.locksAt', { time: new Date(data.notesLockedAt).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })}
        </p>
      )}
      {data.prescriptions.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-bold text-ink">{t('summary.prescriptions')}</p>
          <ul className="space-y-1.5">
            {data.prescriptions.map((p) => (
              <li key={p.id}>
                <Link to={`${isDoctor ? '/doctor' : '/patient'}/prescriptions/${p.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-subtle">
                  <span className="font-semibold text-ink">{p.reference}</span>
                  <RxStatusBadge status={p.status} />
                  <ChevronRight className="ml-auto h-4 w-4 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-2xs text-muted">{t('summary.separate')}</p>
    </section>
  );
}
