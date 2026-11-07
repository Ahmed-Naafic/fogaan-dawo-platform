import { cn } from '@/lib/cn';

/**
 * variant 'segmented': pill buttons on a tinted track (mobile references).
 * variant 'underline': text tabs with a teal underline (consultation side panel).
 */
export default function Tabs({ items, value, onChange, variant = 'segmented', className }) {
  if (variant === 'underline') {
    return (
      <div role="tablist" className={cn('flex border-b border-line', className)}>
        {items.map((it) => (
          <button
            key={it.value}
            role="tab"
            aria-selected={value === it.value}
            onClick={() => onChange(it.value)}
            className={cn(
              '-mb-px flex-1 border-b-2 px-3 py-3 text-sm font-semibold transition-colors',
              value === it.value ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {it.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div role="tablist" className={cn('flex gap-1 rounded-xl bg-subtle p-1', className)}>
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            'flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-all',
            value === it.value ? 'bg-primary text-primary-fg shadow-glow' : 'text-muted hover:text-ink',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
