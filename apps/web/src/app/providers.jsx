import { BrowserRouter } from 'react-router';
import { ThemeProvider } from '@/lib/theme';
import { I18nProvider } from '@/lib/i18n';
import { ToastProvider } from '@/components/ui/Toast';

/** Every app-wide context, composed once: router → theme → language → notifications. */
export default function AppProviders({ children }) {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <I18nProvider>
          <ToastProvider>{children}</ToastProvider>
        </I18nProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
