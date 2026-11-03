import { cn } from '@/lib/cn';

/** Rounded tinted square holding an icon — used by stat cards and quick actions. */
export const tileTones = {
  teal: 'bg-primary-soft text-primary',
  green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-300',
  blue: 'bg-sky-50 text-sky-600 dark:bg-sky-400/10 dark:text-sky-300',
  purple: 'bg-violet-50 text-violet-600 dark:bg-violet-400/10 dark:text-violet-300',
  gold: 'bg-amber-50 text-amber-600 dark:bg-amber-400/10 dark:text-amber-300',
  rose: 'bg-rose-50 text-rose-500 dark:bg-rose-400/10 dark:text-rose-300',
};

const sizes = {
  sm: 'h-9 w-9 rounded-lg [&>svg]:h-[18px] [&>svg]:w-[18px]',
  md: 'h-12 w-12 rounded-xl [&>svg]:h-6 [&>svg]:w-6',
  lg: 'h-14 w-14 rounded-2xl [&>svg]:h-7 [&>svg]:w-7',
};

export default function IconTile({ icon: Icon, tone = 'teal', size = 'md', round = false, className }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center', tileTones[tone], sizes[size], round && '!rounded-full', className)}>
      <Icon strokeWidth={1.9} />
    </span>
  );
}
