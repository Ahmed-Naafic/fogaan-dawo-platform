import { cn } from '@/lib/cn';

/** Call control: labelled button (desktop bar) or round icon button (mobile). */
export default function Control({ icon: Icon, label, active = true, onClick, round = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!active}
      aria-label={label}
      className={cn(
        'flex flex-col items-center gap-1 text-white transition-colors',
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
