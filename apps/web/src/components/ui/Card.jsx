/** Card container and CardHeader (title, subtitle, optional action). */
import { cn } from '@/lib/cn';

export default function Card({ as: Tag = 'section', className, children, ...props }) {
  return (
    <Tag className={cn('card', className)} {...props}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, subtitle, action, className }) {
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-base font-bold sm:text-[17px]">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted sm:text-sm">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
