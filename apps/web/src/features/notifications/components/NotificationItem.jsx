import { Bell, CalendarDays, CreditCard, RotateCcw, ShieldCheck, Video } from 'lucide-react';
import { cn } from '@/lib/cn';

const ICONS = { BOOKING: CalendarDays, PAYMENT: CreditCard, REFUND: RotateCcw, CONSULTATION: Video, SYSTEM: ShieldCheck };

/** "5 min ago" in the current language (falls back to a date after a week). */
export function timeAgo(iso, locale) {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, 'second');
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 7 * 86_400) return rtf.format(Math.round(seconds / 86_400), 'day');
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function NotificationIcon({ type, read }) {
  const Icon = ICONS[type] ?? Bell;
  return (
    <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', read ? 'bg-subtle text-muted' : 'bg-primary-soft text-primary')}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

/** One notification row (title, body, time, unread dot). `compact` for the bell dropdown. */
export default function NotificationItem({ item, locale, compact = false, unreadLabel }) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-3">
      <NotificationIcon type={item.type} read={item.read} />
      <div className="min-w-0 flex-1">
        <p className={cn('flex items-center gap-2 text-sm', item.read ? 'font-semibold text-ink/80' : 'font-bold text-ink')}>
          <span className="truncate">{item.title}</span>
          {!item.read && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label={unreadLabel} role="img" />}
        </p>
        <p className={cn('mt-0.5 text-xs leading-relaxed text-muted', compact && 'line-clamp-2')}>{item.body}</p>
        <p className="mt-1 text-2xs text-muted">{timeAgo(item.createdAt, locale)}</p>
      </div>
    </div>
  );
}
