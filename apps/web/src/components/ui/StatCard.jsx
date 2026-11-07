import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/cn';
import IconTile from './IconTile';

/**
 * Dashboard KPI tile. Desktop: icon left + label/value. Compact: label above value (mobile 2x2 grid).
 */
export default function StatCard({ icon, tone = 'teal', label, value, trend, trendLabel, compact = false, className }) {
  if (compact) {
    return (
      <div className={cn('card flex flex-col gap-1.5 p-3.5', className)}>
        <div className="flex items-center gap-1.5 text-2xs font-semibold text-muted">
          {icon && <IconTile icon={icon} tone={tone} size="sm" className="!h-6 !w-6 !rounded-md [&>svg]:!h-3.5 [&>svg]:!w-3.5" />}
          <span className="truncate">{label}</span>
        </div>
        <div className="text-xl font-extrabold tracking-tight">{value}</div>
        {trend && (
          <div className="flex items-center gap-0.5 text-2xs font-bold text-success">
            <ArrowUp className="h-3 w-3" /> {trend}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className={cn('card flex items-center gap-3.5 p-4', className)}>
      <IconTile icon={icon} tone={tone} size="md" />
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-muted">{label}</div>
        <div className="mt-0.5 text-2xl font-extrabold leading-tight tracking-tight">{value}</div>
        {trend && (
          <div className="mt-0.5 flex items-center gap-0.5 text-2xs font-bold text-success">
            <ArrowUp className="h-3 w-3" />
            {trend}
            {trendLabel && <span className="ml-0.5 font-medium">{trendLabel}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
