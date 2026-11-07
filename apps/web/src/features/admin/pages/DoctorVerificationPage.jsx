import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronRight, ShieldCheck } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import Tabs from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { doctorErrorKey, specialtyName } from '@/features/doctors/doctorApplicationForm';
import { useI18n } from '@/lib/i18n';
import * as api from '../services/verificationApi';

const TABS = ['pending', 'verified', 'rejected'];

/** Admin › Doctor verification — matches the approved "Doctor Verification" screen (tabs + applicant cards). */
export default function DoctorVerificationPage() {
  const { t, lang, locale } = useI18n();
  const notify = useToast();
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'pending';
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    api
      .listApplications(tab)
      .then((d) => !cancelled && setData(d))
      .catch((error) => !cancelled && (setData({ items: [], counts: {} }), notify(t(doctorErrorKey(error)), 'error')));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per tab
  }, [tab]);

  const fmt = (d) => (d ? new Date(d).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

  return (
    <>
      <PageHeader title={t('verification.title')} subtitle={t('verification.subtitle')} back="/admin" />
      <Tabs
        className="mb-5 max-w-lg"
        value={tab}
        onChange={(value) => setParams(value === 'pending' ? {} : { tab: value }, { replace: true })}
        items={[
          { value: 'pending', label: t('verification.tabs.pending', { count: data?.counts?.pending ?? '…' }) },
          { value: 'verified', label: t('verification.tabs.verified') },
          { value: 'rejected', label: t('verification.tabs.rejected') },
        ]}
      />

      {!data ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-[88px] animate-pulse" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <ShieldCheck className="h-7 w-7" />
          </span>
          <p className="mt-4 text-sm text-muted">{t(`verification.empty.${tab}`)}</p>
        </div>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {data.items.map((item) => (
            <li key={item.doctorId}>
              <Link to={`/admin/verification/${item.doctorId}`} className="card flex items-center gap-3.5 p-4 transition-shadow hover:shadow-float">
                <Avatar name={item.name} size="lg" className="ring-2 ring-primary-soft" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 truncate text-[15px] font-bold">
                    {item.name}
                    {item.status === 'UNDER_REVIEW' && <Badge tone="blue">{t('appStatus.UNDER_REVIEW')}</Badge>}
                  </p>
                  <p className="text-sm text-muted">{specialtyName(item.specialty, lang)}</p>
                  <p className="text-xs text-muted">{t(tab === 'pending' ? 'verification.submitted' : 'verification.decided', { date: fmt(tab === 'pending' ? item.submittedAt : item.resolvedAt) })}</p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
