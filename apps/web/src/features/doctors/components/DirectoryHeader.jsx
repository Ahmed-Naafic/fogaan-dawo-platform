import { useOutletContext } from 'react-router';
import PageHeader from '@/components/layout/PageHeader';

/** In the signed-in shell: the app PageHeader. On the public directory: a plain page title. */
export function usePublicView() {
  return !!useOutletContext()?.publicView;
}

export default function DirectoryHeader({ title, subtitle, mobileTitle, back }) {
  const publicView = usePublicView();
  if (!publicView) return <PageHeader title={title} mobileTitle={mobileTitle} subtitle={subtitle} back={back} />;
  return (
    <header className="pb-5 pt-4 lg:pb-6 lg:pt-6">
      <h1 className="text-[22px] font-extrabold leading-tight sm:text-[26px]">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
    </header>
  );
}
