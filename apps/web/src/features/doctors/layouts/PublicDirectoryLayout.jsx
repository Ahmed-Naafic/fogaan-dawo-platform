import { Outlet } from 'react-router';
import PublicHeader from '@/components/layout/PublicHeader';

/** Frame for the public doctor directory (no login): the landing header plus the page. */
export default function PublicDirectoryLayout() {
  return (
    <div className="min-h-screen bg-bg">
      <PublicHeader />
      <main className="mx-auto max-w-site px-4 pb-16 sm:px-6">
        <Outlet context={{ publicView: true }} />
      </main>
    </div>
  );
}
