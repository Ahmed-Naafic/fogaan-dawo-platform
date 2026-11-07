import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { CheckCircle2, PlayCircle, XCircle } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import { ApplicationStatusBadge, DocumentRow, VerificationHistory } from '@/features/doctors/components/ApplicationParts';
import { doctorErrorKey, specialtyName } from '@/features/doctors/doctorApplicationForm';
import { useI18n } from '@/lib/i18n';
import * as api from '../services/verificationApi';

function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-2xs font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-ink">{children || '—'}</dd>
    </div>
  );
}

/** Admin › Doctor verification › one application: profile, private documents, history and the decision. */
export default function DoctorApplicationReviewPage() {
  const { doctorId } = useParams();
  const { t, lang } = useI18n();
  const notify = useToast();
  const { session } = useAuth();
  const [app, setApp] = useState(undefined);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getApplication(doctorId)
      .then((a) => !cancelled && setApp(a))
      .catch((error) => !cancelled && (setApp(null), notify(t(doctorErrorKey(error)), 'error')));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per application
  }, [doctorId]);

  async function act(kind) {
    if (kind === 'reject' && reason.trim().length < 10) return notify(t('verification.reasonRequired'), 'error');
    setBusy(kind);
    try {
      const updated = kind === 'start' ? await api.startReview(doctorId) : kind === 'approve' ? await api.approve(doctorId, notes.trim() || undefined) : await api.reject(doctorId, reason.trim());
      setApp(updated);
      setReason('');
      setNotes('');
      notify(t(`verification.done.${kind}`), 'success');
    } catch (error) {
      notify(t(doctorErrorKey(error)), 'error');
    } finally {
      setBusy(null);
    }
  }

  if (app === undefined) {
    return (
      <>
        <PageHeader title={t('verification.title')} back="/admin/verification" />
        <Card className="h-48 animate-pulse" aria-busy="true" />
      </>
    );
  }
  if (app === null) {
    return (
      <>
        <PageHeader title={t('verification.title')} back="/admin/verification" />
        <Card className="p-8 text-center text-sm text-muted">{t('verification.notFound')}</Card>
      </>
    );
  }

  const own = app.applicant.id === session.user.id;
  const decidable = ['PENDING', 'UNDER_REVIEW'].includes(app.status);
  const previous = app.documentHistory.filter((d) => !d.isCurrent);

  return (
    <>
      <PageHeader title={app.professionalName} subtitle={specialtyName(app.specialty, lang)} back="/admin/verification" />
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Card className="p-5 sm:p-6">
            <div className="flex items-center gap-4">
              <Avatar name={app.professionalName} size="xl" className="ring-4 ring-primary-soft" />
              <div className="min-w-0 flex-1">
                <p className="text-lg font-bold">{app.professionalName}</p>
                <p className="text-sm text-muted">{specialtyName(app.specialty, lang)}</p>
                <div className="mt-2">
                  <ApplicationStatusBadge status={app.status} />
                </div>
              </div>
            </div>
            <dl className="mt-6 grid gap-4 sm:grid-cols-2">
              <Detail label={t('verification.fields.email')}>{app.applicant.email}</Detail>
              <Detail label={t('verification.fields.phone')}>{app.applicant.phone}</Detail>
              <Detail label={t('doctorApp.fields.licenceNumber')}>{app.licenceNumber}</Detail>
              <Detail label={t('doctorApp.fields.licenceCountry')}>{app.licenceCountry}</Detail>
              <Detail label={t('doctorApp.fields.consultationFee')}>${app.consultationFee}</Detail>
              <Detail label={t('doctorApp.fields.yearsExperience')}>{app.yearsExperience ?? '—'}</Detail>
              <Detail label={t('doctorApp.fields.languages')}>{app.languages.map((l) => t(`languageNames.${l}`)).join(', ')}</Detail>
            </dl>
            <div className="mt-5">
              <p className="text-2xs font-semibold uppercase tracking-wider text-muted">{t('doctorApp.fields.bio')}</p>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-ink">{app.bio}</p>
            </div>
          </Card>

          <Card className="p-5 sm:p-6">
            <CardHeader title={t('doctorApp.sections.documents')} subtitle={t('verification.documentsPrivate')} />
            <ul className="space-y-4">
              {app.documents.map((doc) => (
                <li key={doc.id}>
                  <p className="mb-2 text-xs font-bold">{t(`docType.${doc.documentType}`)}</p>
                  <DocumentRow document={doc} download={(id) => api.downloadApplicationDocument(doctorId, id)} />
                </li>
              ))}
            </ul>
            {previous.length > 0 && (
              <details className="mt-5 rounded-xl border border-line p-3.5">
                <summary className="cursor-pointer text-xs font-semibold text-ink">{t('verification.previousVersions', { count: previous.length })}</summary>
                <ul className="mt-3 space-y-3">
                  {previous.map((doc) => (
                    <li key={doc.id}>
                      <p className="mb-1.5 text-2xs font-semibold text-muted">{t(`docType.${doc.documentType}`)}</p>
                      <DocumentRow document={doc} download={(id) => api.downloadApplicationDocument(doctorId, id)} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5 sm:p-6">
            <CardHeader title={t('verification.sections.decision')} />
            {own ? (
              <p className="text-sm text-muted">{t('verification.ownApplication')}</p>
            ) : !decidable ? (
              <p className="text-sm text-muted">{t('verification.decided', { date: app.latestRequest?.resolvedAt ? new Date(app.latestRequest.resolvedAt).toLocaleDateString() : '—' })}</p>
            ) : (
              <div className="space-y-5">
                {app.status === 'PENDING' && (
                  <Button variant="secondary" className="w-full" onClick={() => act('start')} disabled={busy !== null}>
                    <PlayCircle className="h-4 w-4" /> {t('verification.startReview')}
                  </Button>
                )}
                <div>
                  <label htmlFor="approve-notes" className="mb-1.5 block text-xs font-semibold">
                    {t('verification.approveNotes')}
                  </label>
                  <Textarea id="approve-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  <Button className="mt-2.5 w-full" onClick={() => act('approve')} disabled={busy !== null}>
                    <CheckCircle2 className="h-4 w-4" /> {busy === 'approve' ? t('auth.pleaseWait') : t('verification.approve')}
                  </Button>
                </div>
                <div className="border-t border-line pt-5">
                  <label htmlFor="reject-reason" className="mb-1.5 block text-xs font-semibold">
                    {t('verification.rejectReason')}
                  </label>
                  <Textarea id="reject-reason" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
                  <p className="mt-1.5 text-2xs text-muted">{t('verification.rejectReasonHint')}</p>
                  <Button variant="danger" className="mt-2.5 w-full" onClick={() => act('reject')} disabled={busy !== null}>
                    <XCircle className="h-4 w-4" /> {busy === 'reject' ? t('auth.pleaseWait') : t('verification.reject')}
                  </Button>
                </div>
              </div>
            )}
          </Card>

          <Card className="p-5 sm:p-6">
            <CardHeader title={t('doctorApp.sections.history')} />
            <VerificationHistory history={app.history} />
          </Card>
        </div>
      </div>
    </>
  );
}
