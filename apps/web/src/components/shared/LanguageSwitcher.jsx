import { useCallback, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import useClickOutside from '@/hooks/useClickOutside';
import { LANGUAGES, useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import Flag from './Flag';

export default function LanguageSwitcher({ className, align = 'right', tone = 'default' }) {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const current = LANGUAGES.find((l) => l.code === lang);

  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('common.language')}
        className={cn(
          'inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-colors',
          tone === 'dark' ? 'border-white/15 text-white hover:bg-white/10' : 'border-line bg-surface text-ink hover:bg-subtle',
        )}
      >
        <Flag code={current.flag} />
        {current.short}
        <ChevronDown className="h-3.5 w-3.5 opacity-70" />
      </button>
      {open && (
        <ul
          role="listbox"
          className={cn('absolute z-50 mt-2 w-44 overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-float', align === 'right' ? 'right-0' : 'left-0')}
        >
          {LANGUAGES.map((l) => (
            <li key={l.code}>
              <button
                role="option"
                aria-selected={l.code === lang}
                onClick={() => {
                  setLang(l.code);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-ink hover:bg-subtle"
              >
                <Flag code={l.flag} />
                <span className="flex-1">{l.label}</span>
                {l.code === lang && <Check className="h-4 w-4 text-primary" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
