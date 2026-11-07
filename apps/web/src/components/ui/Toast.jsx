import { createContext, useCallback, useContext, useState } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

const ToastContext = createContext(() => {});

/** Lightweight notification: info, success, or error (e.g. sign-in errors mapped from API codes). */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const notify = useCallback((message, tone = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list, { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), tone === 'error' ? 5000 : 3200);
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-24 z-[100] flex flex-col items-center gap-2 px-4 lg:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-xl bg-brand-navy px-4 py-3 text-sm font-medium text-white shadow-float dark:bg-[#12323F]">
            {t.tone === 'success' ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
            ) : t.tone === 'error' ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-300" />
            ) : (
              <Info className="h-4 w-4 shrink-0 text-teal-300" />
            )}
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
