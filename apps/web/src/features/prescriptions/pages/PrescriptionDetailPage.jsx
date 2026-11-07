import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Ban, CalendarDays, RefreshCw, ShieldCheck } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n';
import { CancelRxDialog, ReplaceRxDialog, RxItems, RxLifecycle, RxPdfActions, RxSummary } from '../components/RxParts';
import { rxErrorKey } from '../prescriptionUi';
import { cancelPrescription, getPrescription, replacePrescription } from '../services/prescriptionApi';

/**
 * /patient/prescriptions/:id and /doctor/prescriptions/:id. Issued content is read-only for everyone;
 * the prescribing doctor can replace (correction, with reason) or cancel (with reason). Drafts are edited
 * from the consultation.
 */
export default function PrescriptionDetailPage({ viewer }) {
  const { prescriptionId } = useParams();
  const { t } = useI18n();
  const notify = useToast();
  const navigate = useNavigate();
  const isDoctor = viewer === 'DOCTOR';
  const base = isDoctor ? '/doctor/prescriptions' : '/patient/prescriptions';
  const [rx, setRx] = useState(undefined);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setRx(undefined);
    getPrescription(prescriptionId)
      .then(setRx)
      .catch(() => setRx(null));
  }, [prescriptionId]);
  useEffect(load, [load]);

  async function cancel(reason) {
    setBusy(true);
    try {
      setRx(await cancelPrescription(rx.id, reason));
      setDialog(null);
      notify(t('rx.cancelledToast'), 'success');
    } catch (error) {
      notify(t(rxErrorKey(error)), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function replace(body) {
    setBusy(true);
    try {
      const next = await replacePrescription(rx.id, body);
      setDialog(null);
      notify(t('rx.replacedToast', { reference: next.reference }), 'success');
      navigate(`${base}/${next.id}`);
    } catch (error) {
      notify(t(rxErrorKey(error)), 'error');
    } finally {
      setBusy(false);
    }
  }

  const header = <PageHeader title={t('rx.detailTitle')} subtitle={t('rx.detailSubtitle')} back={base} />;
  if (rx === undefined) {
    return (
      <>
        {header}
        <div className="card h-72 animate-pulse" aria-busy="true" />
      </>
    );
  }
  if (rx === null) {
    return (
      <>
        {header}
        <Card className="p-6 text-center" role="alert">
          <p className="text-sm text-muted">{t('rx.notFound')}</p>
          <Button variant="secondary" size="sm" className="mt-3" to={base}>
            {t('rx.backToList')}
          </Button>
        </Card>
      </>
    );
  }

  const apptLink = rx.appointmentId ? `${isDoctor ? '/doctor' : '/patient'}/appointments/${rx.appointmentId}` : null;
  return (
    <>
      {header}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="p-5 sm:p-6" data-rx-detail={rx.status}>
          <RxSummary rx={rx} />
          <div className="mt-5">
            <h2 className="mb-3 text-sm font-bold">{t('rx.medicines')}</h2>
            <RxItems items={rx.items} />
          </div>
          {rx.generalNotes && (
            <div className="mt-5">
              <h2 className="mb-1 text-sm font-bold">{t('rx.fields.generalNotes')}</h2>
              <p className="whitespace-pre-line break-words text-sm text-ink">{rx.generalNotes}</p>
            </div>
          )}
          <div className="mt-6 border-t border-line pt-5">
            <RxPdfActions rx={rx} />
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <CardHeader title={t('rx.lifecycle')} />
            <RxLifecycle status={rx.status} />
            <p className="mt-3 flex items-start gap-1.5 text-2xs text-muted">
              <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" /> {t('rx.immutableNote')}
            </p>
            {apptLink && (
              <Link to={apptLink} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
                <CalendarDays className="h-3.5 w-3.5" /> {t('rx.openAppointment')}
              </Link>
            )}
          </Card>
          {isDoctor && rx.actions && (rx.actions.replace || rx.actions.cancel) && (
            <Card className="p-5" data-rx-doctor-actions>
              <CardHeader title={t('rx.manage')} subtitle={t('rx.manageHint')} />
              <div className="grid gap-2">
                {rx.actions.replace && (
                  <Button variant="outline" onClick={() => setDialog('replace')} data-rx-replace-open>
                    <RefreshCw className="h-4 w-4" /> {t('rx.replace')}
                  </Button>
                )}
                {rx.actions.cancel && (
                  <Button variant="secondary" className="text-danger" onClick={() => setDialog('cancel')} data-rx-cancel-open>
                    <Ban className="h-4 w-4" /> {t('rx.cancel')}
                  </Button>
                )}
              </div>
              {!rx.actions.replace && rx.status === 'VALID' && <p className="mt-3 text-2xs text-muted">{t('rx.replaceWindowClosed')}</p>}
            </Card>
          )}
        </div>
      </div>
      {dialog === 'cancel' && <CancelRxDialog busy={busy} onCancel={() => setDialog(null)} onConfirm={cancel} />}
      {dialog === 'replace' && <ReplaceRxDialog rx={rx} busy={busy} onCancel={() => setDialog(null)} onConfirm={replace} />}
    </>
  );
}
