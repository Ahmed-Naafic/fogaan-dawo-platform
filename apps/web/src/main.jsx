import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/app/App';
import AppProviders from '@/app/providers';
import '@/styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>,
);

// PWA: app-shell service worker, production builds only (never in `vite dev`, so code changes are never cached).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* unsupported or blocked: the app works the same without offline support */
    });
  });
}
