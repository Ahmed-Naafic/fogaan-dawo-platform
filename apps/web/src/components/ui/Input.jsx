/** Form controls: Input (optional icon/trailing element), Select and Textarea, styled for both themes. */
import { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

const field =
  'w-full rounded-xl border border-line bg-subtle/70 text-sm text-ink placeholder:text-muted/80 transition-colors focus:border-primary/60 focus:bg-surface focus:outline-none focus:ring-4 focus:ring-primary/10';

export const Input = forwardRef(function Input({ icon: Icon, trailing, className, inputClassName, ...props }, ref) {
  return (
    <label className={cn('relative block', className)}>
      {Icon && <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted" />}
      <input ref={ref} className={cn(field, 'h-11', Icon ? 'pl-10' : 'pl-4', trailing ? 'pr-11' : 'pr-4', inputClassName)} {...props} />
      {trailing && <span className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</span>}
    </label>
  );
});

export function Textarea({ className, ...props }) {
  return <textarea className={cn(field, 'min-h-[96px] resize-y px-4 py-3 leading-relaxed', className)} {...props} />;
}

export function Select({ className, children, icon: Icon, ...props }) {
  return (
    <label className={cn('relative block', className)}>
      {Icon && <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />}
      <select
        className={cn(field, 'h-11 cursor-pointer appearance-none pr-10 font-medium', Icon ? 'pl-10' : 'pl-4')}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
    </label>
  );
}
