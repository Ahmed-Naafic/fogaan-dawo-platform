/** Small coloured status label (tone: teal, green, gold, red, blue, purple, neutral). */
import { cn } from '@/lib/cn';

const tones = {
  teal: 'bg-primary-soft text-primary',
  gold: 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
  blue: 'bg-sky-100 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300',
  purple: 'bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300',
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
  red: 'bg-red-500 text-white',
  neutral: 'bg-subtle text-muted',
};

export default function Badge({ tone = 'teal', className, children, icon: Icon }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-2xs font-semibold', tones[tone], className)}>
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}
