import { useLocation, useOutletContext } from 'react-router';
import { Construction } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Button from '@/components/ui/Button';
import { navigation } from '@/app/navigation';
import { useI18n } from '@/lib/i18n';

/** Placeholder for sidebar destinations scheduled for later phases. */
export default function ComingSoonPage() {
  const { role } = useOutletContext();
  const { t } = useI18n();
  const { pathname } = useLocation();
  const nav = navigation[role];
  const item = [...nav.sidebar, ...nav.tabs].find((i) => i.to === pathname);
  const title = item ? t(item.label) : t('comingSoon.title');

  return (
    <>
      <PageHeader title={title} back={nav.home} />
      <div className="card flex flex-col items-center px-6 py-16 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <Construction className="h-8 w-8" />
        </span>
        <h2 className="mt-5 text-lg font-bold">{t('comingSoon.heading', { page: title })}</h2>
        <p className="mt-2 max-w-sm text-sm text-muted">{t('comingSoon.body')}</p>
        <Button to={nav.home} className="mt-6">
          {t('comingSoon.back')}
        </Button>
      </div>
    </>
  );
}
