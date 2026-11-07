import { useState } from 'react';
import { CheckCircle2, Circle, Eye, FileText } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import IconTile from '@/components/ui/IconTile';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n';
import { doctorErrorKey, formatFileSize, openPrivateDocument, STATUS_TONE } from '../doctorApplicationForm';

/** Building blocks shared by the applicant page, the admin review page and the doctor dashboard. */

export function ApplicationStatusBadge({ status }) {
  const { t } = useI18n();
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{t(`appStatus.${status}`)}</Badge>;
}

export function CompletionBar({ completion, showMissing = true }) {
  const { t } = useI18n();
  return (
    <div>
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-muted">{t('doctorApp.completion')}</span>
        <span className="text-ink">{t('doctorApp.completionValue', { percent: completion.percent })}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={completion.percent} aria-valuemin={0} aria-valuemax={100} aria-label={t('doctorApp.completion')}>
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${completion.percent}%` }} />
      </div>
      {showMissing && completion.missing.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {completion.missing.map((m) => (
            <li key={m.key} className="flex items-center gap-2 text-xs text-muted">
              <Circle className="h-3.5 w-3.5 shrink-0" />
              {t(`doctorApp.missing.${m.key}`)}
              {m.required && <span className="font-semibold text-danger">· {t('doctorApp.required')}</span>}
            </li>
          ))}
        </ul>
      )}
      {showMissing && completion.missing.length === 0 && (
        <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-success">
          <CheckCircle2 className="h-4 w-4" /> {t('doctorApp.allComplete')}
        </p>
      )}
    </div>
  );
}

/** One document row with a secure "View" action (fetched with the bearer token, opened from a blob URL). */
export function DocumentRow({ document, download, action }) {
  const { t, locale } = useI18n();
  const notify = useToast();
  const [opening, setOpening] = useState(false);
  const view = async () => {
    setOpening(true);
    try {
      await openPrivateDocument(() => download(document.id), document.fileName);
    } catch (error) {
      notify(t(doctorErrorKey(error)), 'error');
    } finally {
      setOpening(false);
    }
  };
  return (
    <div className="flex items-center gap-3">
      <IconTile icon={FileText} tone="blue" size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{document.fileName}</p>
        <p className="text-2xs text-muted">
          {t('doctorApp.version', { n: document.versionNumber })} · {formatFileSize(document.fileSize)} ·{' '}
          {new Date(document.uploadedAt).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={view} disabled={opening} aria-label={`${t('doctorApp.view')} ${document.fileName}`}>
        <Eye className="h-3.5 w-3.5" /> {t('doctorApp.view')}
      </Button>
      {action}
    </div>
  );
}

/** Verification history: every submission and every admin action, newest submission first. */
export function VerificationHistory({ history }) {
  const { t, locale } = useI18n();
  const fmt = (d) => new Date(d).toLocaleString(locale, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  if (!history?.length) return <p className="text-sm text-muted">{t('doctorApp.noHistory')}</p>;
  return (
    <ol className="space-y-4">
      {history.map((req) => (
        <li key={req.id} className="rounded-xl border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{t('doctorApp.historySubmitted', { date: fmt(req.submittedAt) })}</p>
            <ApplicationStatusBadge status={{ APPROVED: 'VERIFIED', REJECTED: 'REJECTED', UNDER_REVIEW: 'UNDER_REVIEW' }[req.status] ?? 'PENDING'} />
          </div>
          {req.reviews.length > 0 && (
            <ul className="mt-3 space-y-2 border-l-2 border-line pl-4">
              {req.reviews.map((rv) => (
                <li key={rv.id} className="text-xs">
                  <span className="font-semibold text-ink">{t(`doctorApp.historyReview.${rv.status}`, { name: rv.reviewer?.fullName ?? '—' })}</span>
                  <span className="text-muted"> · {fmt(rv.createdAt)}</span>
                  {rv.notes && <p className="mt-1 whitespace-pre-line text-muted">“{rv.notes}”</p>}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
