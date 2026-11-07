import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

export default function ThemeToggle({ className, tone = 'default' }) {
  const { isDark, toggleTheme } = useTheme();
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? t('common.lightMode') : t('common.darkMode')}
      title={isDark ? t('common.lightMode') : t('common.darkMode')}
      className={cn(
        'inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors',
        tone === 'dark' ? 'border-white/15 text-white hover:bg-white/10' : 'border-line bg-surface text-ink hover:bg-subtle',
        className,
      )}
    >
      {isDark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
}
