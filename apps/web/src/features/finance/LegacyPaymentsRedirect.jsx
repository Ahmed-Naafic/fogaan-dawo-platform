import { Navigate, useSearchParams } from 'react-router';

/** Old /admin/payments?tab=… links (bookmarks, earlier notifications) open the new finance pages. */
export default function LegacyPaymentsRedirect() {
  const [params] = useSearchParams();
  const tab = params.get('tab');
  const to = tab === 'refunds' ? '/admin/finance/refunds' : tab === 'payments' ? '/admin/finance/payments' : '/admin/finance';
  return <Navigate to={to} replace />;
}
