import { useState } from 'react';
import { Search } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/Input';
import { useI18n } from '@/lib/i18n';
import { apiRequest } from '@/lib/apiClient';
import { LoadState, Pager } from '@/features/finance/components/FinanceFrame';
import { useDebounced, useLoad } from '@/features/finance/financeUi';
import SmsOutboxList from '@/features/notifications/components/SmsOutboxList';

/** /admin/sms-outbox — every simulated SMS written by the system (number, text, status, time). */
export default function AdminSmsOutboxPage() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const query = useDebounced(q.trim());
  const state = useLoad(() => apiRequest(`/v1/admin/sms-outbox?${new URLSearchParams({ ...(query ? { q: query } : {}), page: String(page) })}`), [query, page]);
  return (
    <>
      <PageHeader title={t('sms.adminTitle')} subtitle={t('sms.adminSubtitle')} />
      <div className="mb-4 max-w-md">
        <Input
          icon={Search}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder={t('sms.search')}
          aria-label={t('sms.search')}
        />
      </div>
      <LoadState state={state}>
        {state.data && (
          <>
            <SmsOutboxList items={state.data.items} showUser />
            <Pager page={state.data.page} pageSize={state.data.pageSize} total={state.data.total} onPage={setPage} />
          </>
        )}
      </LoadState>
    </>
  );
}
