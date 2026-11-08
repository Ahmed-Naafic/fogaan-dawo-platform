import { useEffect, useState } from 'react';
import DoctorEditDialog from '../components/DoctorEditDialog';
import { Link, useSearchParams } from 'react-router';
import { Ban, Eye, Search, Stethoscope, Pencil } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import Tabs from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import { specialtyName, STATUS_TONE } from '@/features/doctors/doctorApplicationForm';
import { useI18n } from '@/lib/i18n';
import SuspendDoctorDialog from '../components/SuspendDoctorDialog';
import { adminDoctorErrorKey, canSuspend, displayStatus, DOCTOR_TABS } from '../doctorAdmin';
import * as api from '../services/doctorAdminApi';

const TONE = { ...STATUS_TONE, SUSPENDED: 'red' };

function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-medium text-muted">{label}</dt>
      <dd className="break-words text-xs font-semibold text-ink">{children}</dd>
    </div>
  );
}

/** Admin › Doctors — registered doctors with status, professional details and a Suspend action. */
export default function AdminDoctorsPage() {
  const { t, lang, locale } = useI18n();
  const notify = useToast();
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = DOCTOR_TABS.includes(params.get('tab')) ? params.get('tab') : 'all';
  const [term, setTerm] = useState(params.get('q') ?? '');
  const q = params.get('q') ?? '';
  const [data, setData] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [suspending, setSuspending] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      if (term.trim() !== q) setParams((prev) => {
        const next = new URLSearchParams(prev);
        term.trim() ? next.set('q', term.trim()) : next.delete('q');
        return next;
      }, { replace: true });
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce the search box only
  }, [term]);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    api
      .listDoctors({ tab, q })
      .then((d) => !cancelled && setData(d))
      .catch((error) => !cancelled && (setData({ items: [], counts: {}, total: 0 }), notify(t(adminDoctorErrorKey(error)), 'error')));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per tab / search / after a suspension
  }, [tab, q, reloadKey]);

  const fmt = (d) => (d ? new Date(d).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
  const count = (name) => data?.counts?.[name] ?? '…';

  const saveEdit = async (payload) => {
    setBusy(true);
    try {
      await api.updateDoctor(editing.doctorId, payload);
      notify(t('adminDoctors.edit.saved', { name: editing.name }));
      setEditing(null);
      setReloadKey((k) => k + 1);
    } catch (error) {
      notify(t(error?.code === 'VALIDATION_ERROR' ? 'adminDoctors.edit.errors.invalid' : adminDoctorErrorKey(error)), 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmSuspend = async (reason) => {
    setBusy(true);
    try {
      const result = await api.suspendDoctor(suspending.doctorId, reason);
      notify(t('adminDoctors.suspended', { name: suspending.name, count: result.cancelledAppointments }));
      setSuspending(null);
      setReloadKey((k) => k + 1);
    } catch (error) {
      notify(t(adminDoctorErrorKey(error)), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={t('adminDoctors.title')} subtitle={t('adminDoctors.subtitle')} back="/admin" />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="-mx-4 overflow-x-auto px-4 pb-1 scrollbar-none lg:mx-0 lg:px-0">
          <Tabs
            className="min-w-[34rem] lg:w-[40rem]"
            value={tab}
            onChange={(value) => setParams((prev) => {
              const next = new URLSearchParams(prev);
              value === 'all' ? next.delete('tab') : next.set('tab', value);
              return next;
            }, { replace: true })}
            items={DOCTOR_TABS.map((name) => ({ value: name, label: t(`adminDoctors.tabs.${name}`, { count: count(name) }) }))}
          />
        </div>
        <Input icon={Search} value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('adminDoctors.searchPlaceholder')} aria-label={t('common.search')} className="lg:ml-auto lg:w-72" name="q" />
      </div>

      <div className="mt-5">
        {!data ? (
          <div className="grid gap-3 lg:grid-cols-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card h-44 animate-pulse" />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <div className="card flex flex-col items-center px-6 py-14 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
              <Stethoscope className="h-7 w-7" />
            </span>
            <p className="mt-4 text-sm text-muted">{t(q ? 'adminDoctors.noMatch' : `adminDoctors.empty.${tab}`)}</p>
          </div>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2" aria-label={t('adminDoctors.title')}>
            {data.items.map((d) => {
              const status = displayStatus(d);
              return (
                <li key={d.doctorId} className="card flex flex-col p-4 sm:p-5" data-doctor={d.doctorId}>
                  <div className="flex items-start gap-3.5">
                    <Avatar name={d.name} size="lg" className="ring-2 ring-primary-soft" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-[15px] font-bold">
                        <span className="truncate">{d.name}</span>
                        <Badge tone={TONE[status] ?? 'neutral'}>{t(`appStatus.${status}`)}</Badge>
                        {d.cancellationFlag && (
                          <Badge tone="red" data-cancellation-flag>
                            {t('adminDoctors.cancellationFlag', { count: d.cancellationsThisMonth })}
                          </Badge>
                        )}
                      </p>
                      <p className="text-sm text-muted">{specialtyName(d.specialty, lang)}</p>
                      <p className="truncate text-xs text-muted">{d.email ?? d.phone ?? '—'}</p>
                    </div>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl bg-subtle p-3 sm:grid-cols-[1fr_1.6fr_1.2fr_1fr]">
                    <Fact label={t('adminDoctors.fee')}>{`$${d.consultationFee}`}</Fact>
                    <Fact label={t('adminDoctors.licence')}>{`${d.licenceCountry} · ${d.licenceNumber}`}</Fact>
                    <Fact label={t('adminDoctors.languages')}>{d.languages.map((l) => t(`languageNames.${l}`)).join(', ') || '—'}</Fact>
                    <Fact label={d.verifiedAt ? t('adminDoctors.verifiedOn') : t('adminDoctors.registeredOn')}>{fmt(d.verifiedAt ?? d.registeredAt)}</Fact>
                  </dl>
                  {d.suspension && (
                    <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200" role="note">
                      <span className="font-bold">{t('adminDoctors.suspendedBy', { name: d.suspension.by ?? '—', date: fmt(d.suspension.at) })}</span>
                      {d.suspension.reason && <span className="mt-0.5 block">“{d.suspension.reason}”</span>}
                    </p>
                  )}
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setEditing(d)} data-edit-doctor>
                      <Pencil className="h-3.5 w-3.5" /> {t('adminDoctors.edit.button')}
                    </Button>
                    <Button to={`/admin/verification/${d.doctorId}`} variant="secondary" size="sm">
                      <Eye className="h-3.5 w-3.5" /> {t('adminDoctors.view')}
                    </Button>
                    {canSuspend(d, session?.user?.id) && (
                      <Button variant="danger" size="sm" onClick={() => setSuspending(d)} aria-label={t('adminDoctors.suspendFor', { name: d.name })}>
                        <Ban className="h-3.5 w-3.5" /> {t('adminDoctors.suspend')}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {editing && <DoctorEditDialog doctor={editing} busy={busy} onCancel={() => setEditing(null)} onSave={saveEdit} />}
      {suspending && <SuspendDoctorDialog doctor={suspending} busy={busy} onCancel={() => setSuspending(null)} onConfirm={confirmSuspend} />}
    </>
  );
}
