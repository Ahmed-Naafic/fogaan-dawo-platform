import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ChevronRight, ClipboardPlus, Clock, Lock } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/features/profile/components/ProfileParts';
import { useI18n } from '@/lib/i18n';
import { emptyItem, itemsFrom, rxErrorKey, validatePrescription } from '../prescriptionUi';
import { createDraft, discardDraft, getPrescription, issuePrescription, listConsultationPrescriptions, updateDraft } from '../services/prescriptionApi';
import { IssueDialog, RxEditor, RxStatusBadge } from './RxParts';

const fmt = (iso, locale) => (iso ? new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

/**
 * Prescriptions of one consultation. Doctor: drafts (create / edit / issue with confirmation / discard),
 * issued ones link to the detail page (replace / cancel). Patient: issued prescriptions only.
 * The issue action is shown only while the API says the window is open; the API re-checks everything.
 */
export default function ConsultationPrescriptions({ consultationId, role, compact = false, refreshKey }) {
  const { t, locale } = useI18n();
  const notify = useToast();
  const isDoctor = role === 'DOCTOR';
  const base = isDoctor ? '/doctor/prescriptions' : '/patient/prescriptions';
  const [data, setData] = useState(undefined);
  const [editing, setEditing] = useState(null); // null | { id|null, items, notes }
  const [invalid, setInvalid] = useState({});
  const [busy, setBusy] = useState(null);
  const [issuing, setIssuing] = useState(null); // full draft for the confirm dialog
  const [discarding, setDiscarding] = useState(null);

  const load = useCallback(() => {
    if (!consultationId) return;
    listConsultationPrescriptions(consultationId)
      .then(setData)
      .catch(() => setData(null));
  }, [consultationId]);
  useEffect(load, [load, refreshKey]);

  const open = Boolean(data?.window?.open);

  async function save({ thenIssue = false } = {}) {
    const { errors, payload } = validatePrescription({ items: editing.items, generalNotes: editing.notes });
    setInvalid(errors);
    if (!payload) return notify(t(Object.values(errors)[0]), 'error');
    setBusy('save');
    try {
      const saved = editing.id ? await updateDraft(editing.id, payload) : await createDraft(consultationId, payload);
      setEditing(null);
      load();
      if (thenIssue) setIssuing(saved);
      else notify(t('rx.draftSaved'), 'success');
    } catch (error) {
      notify(t(rxErrorKey(error)), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function edit(id) {
    try {
      const rx = await getPrescription(id);
      setInvalid({});
      setEditing({ id, items: itemsFrom(rx.items), notes: rx.generalNotes ?? '' });
    } catch (error) {
      notify(t(rxErrorKey(error)), 'error');
    }
  }

  async function confirmIssue() {
    setBusy('issue');
    try {
      const rx = await issuePrescription(issuing.id);
      setIssuing(null);
      load();
      notify(t('rx.issuedToast', { reference: rx.reference }), 'success');
    } catch (error) {
      notify(t(rxErrorKey(error)), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function confirmDiscard() {
    setBusy('discard');
    try {
      await discardDraft(discarding);
      setDiscarding(null);
      load();
      notify(t('rx.draftDiscarded'), 'success');
    } catch (error) {
      notify(t(rxErrorKey(error)), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function openIssue(id) {
    try {
      setIssuing(await getPrescription(id));
    } catch (error) {
      notify(t(rxErrorKey(error)), 'error');
    }
  }

  const heading = (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className={compact ? 'text-sm font-bold' : 'text-base font-bold sm:text-[17px]'}>{t('rx.consultationTitle')}</h3>
      {isDoctor && open && !editing && (
        <Button size="sm" onClick={() => (setInvalid({}), setEditing({ id: null, items: [emptyItem()], notes: '' }))} data-rx-new>
          <ClipboardPlus className="h-4 w-4" /> {t('rx.new')}
        </Button>
      )}
    </div>
  );

  if (data === undefined) {
    return (
      <section aria-busy="true">
        {heading}
        <div className="h-16 animate-pulse rounded-xl bg-subtle" />
      </section>
    );
  }
  if (data === null) {
    return (
      <section>
        {heading}
        <p className="text-sm text-muted">{t('rx.loadFailed')}</p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={load}>
          {t('profile.retry')}
        </Button>
      </section>
    );
  }

  return (
    <section data-consultation-prescriptions>
      {heading}
      {isDoctor && (
        <p className="mb-3 flex items-start gap-1.5 text-2xs text-muted" data-rx-window={open ? 'open' : 'closed'}>
          {open ? <Clock className="mt-px h-3.5 w-3.5 shrink-0" /> : <Lock className="mt-px h-3.5 w-3.5 shrink-0" />}
          {open
            ? data.window.closesAt
              ? t('rx.windowOpenUntil', { time: fmt(data.window.closesAt, locale) })
              : t('rx.windowOpenLive')
            : t(`rx.windowClosed.${data.window?.reason ?? 'WINDOW_PASSED'}`)}
        </p>
      )}

      {editing && (
        <div className="mb-4 rounded-2xl border border-primary/30 bg-primary-soft/20 p-3 sm:p-4">
          <RxEditor items={editing.items} setItems={(fn) => setEditing((e) => ({ ...e, items: typeof fn === 'function' ? fn(e.items) : fn }))} notes={editing.notes} setNotes={(v) => setEditing((e) => ({ ...e, notes: v }))} invalid={invalid} idPrefix={`rx-${consultationId}`} />
          <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy !== null}>
              {t('common.cancel')}
            </Button>
            <Button variant="secondary" onClick={() => save()} disabled={busy !== null} data-rx-save-draft>
              {busy === 'save' ? t('auth.pleaseWait') : t('rx.saveDraft')}
            </Button>
            <Button onClick={() => save({ thenIssue: true })} disabled={busy !== null} data-rx-review>
              {t('rx.review')}
            </Button>
          </div>
        </div>
      )}

      {data.items.length === 0 && !editing ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted" data-rx-empty>
          {isDoctor ? t('rx.emptyDoctor') : t('rx.emptyPatient')}
        </p>
      ) : (
        <ul className="space-y-2">
          {data.items.map((rx) => (
            <li key={rx.id} className="rounded-xl border border-line p-3" data-rx-row={rx.id}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-ink">{rx.reference ?? t('rx.draftTitle')}</span>
                <RxStatusBadge status={rx.status} />
                <span className="text-2xs text-muted">{t('rx.itemCount', { count: rx.itemCount })}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {rx.status === 'DRAFT' ? (
                  <>
                    {open && (
                      <>
                        <Button size="xs" variant="secondary" onClick={() => edit(rx.id)} disabled={busy !== null}>
                          {t('rx.edit')}
                        </Button>
                        <Button size="xs" onClick={() => openIssue(rx.id)} disabled={busy !== null} data-rx-issue>
                          {t('rx.issue')}
                        </Button>
                      </>
                    )}
                    <Button size="xs" variant="ghost" onClick={() => setDiscarding(rx.id)} disabled={busy !== null}>
                      {t('rx.discard')}
                    </Button>
                  </>
                ) : (
                  <Link to={`${base}/${rx.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" data-rx-open>
                    {t('rx.open')} <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {issuing && <IssueDialog rx={issuing} busy={busy === 'issue'} onCancel={() => (setIssuing(null), load())} onConfirm={confirmIssue} />}
      {discarding && (
        <ConfirmDialog title={t('rx.discardTitle')} body={t('rx.discardBody')} confirmLabel={t('rx.discard')} busy={busy === 'discard'} onCancel={() => setDiscarding(null)} onConfirm={confirmDiscard} />
      )}
    </section>
  );
}
