import { cn } from '@/lib/cn';

/**
 * Call control: labelled button (desktop bar) or round icon button (mobile).
 * `active` = the feature is on (e.g. mic live); `ariaLabel` describes what pressing it does.
 */
export default function Control({ icon: Icon, label, ariaLabel, active = true, onClick, round = false, disabled = false, toggle = true }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={toggle ? !active : undefined}
      aria-label={ariaLabel ?? label}
      title={ariaLabel ?? label}
      className={cn(
        'flex flex-col items-center gap-1 text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-40',
        round ? 'h-12 w-12 justify-center rounded-full' : 'min-w-[56px] rounded-xl px-2 py-1.5 hover:bg-white/10',
        round && (active ? 'bg-white/15 hover:bg-white/25' : 'bg-white text-[#0B2B3C]'),
        !round && !active && 'text-red-300',
      )}
    >
      <Icon className="h-5 w-5" />
      {!round && <span className="text-[11px] font-medium">{label}</span>}
    </button>
  );
}
