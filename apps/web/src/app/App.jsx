import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
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
