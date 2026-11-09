/** Root component: providers (theme, language, auth, notifications, toasts) around the router; scrolls to top on navigation. */
import { useEffect } from 'react';
import { useLocation } from 'react-router';
import AppRouter from './router';

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <AppRouter />
    </>
  );
}
