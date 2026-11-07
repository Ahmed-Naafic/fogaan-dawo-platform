import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Bell, CheckCheck } from 'lucide-react';
import useClickOutside from '@/hooks/useClickOutside';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { useNotifications } from '../NotificationsProvider';
import NotificationItem from './NotificationItem';

/** Header bell: live unread badge and a dropdown of the latest notifications. */
export default function NotificationBell({ buttonClassName }) {
  const { t, locale } = useI18n();
  const n = useNotifications();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);
  if (!n) return null;
  const count = n.unreadCount;

  const openItem = async (item) => {
    setOpen(false);
    if (!item.read) n.setRead(item.id, true).catch(() => {});
    navigate(item.url);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        data-notification-bell
        aria-label={count ? t('notifications.bellUnread', { count }) : t('common.notifications')}
        className={cn('relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink transition-colors hover:bg-subtle', buttonClassName)}
      >
        <Bell className="h-[19px] w-[19px]" />
        {count > 0 && (
          <span data-unread-badge={count} className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-surface">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface shadow-float" role="dialog" aria-label={t('notifications.title')}>
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <p className="text-sm font-extrabold">{t('notifications.title')}</p>
            {count > 0 && (
              <button type="button" onClick={() => n.readAll().catch(() => {})} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-2xs font-bold text-primary hover:bg-primary-soft">
                <CheckCheck className="h-3.5 w-3.5" /> {t('notifications.markAllRead')}
              </button>
            )}
          </div>
          <div className="max-h-[22rem] overflow-y-auto p-1.5">
            {n.latest === null && <div className="m-2 h-16 animate-pulse rounded-xl bg-subtle" />}
            {n.latest?.length === 0 && <p className="px-4 py-8 text-center text-xs text-muted">{t('notifications.empty')}</p>}
            {n.latest?.map((item) => (
              <button
                key={item.id}
                type="button"
                data-notification={item.id}
                onClick={() => openItem(item)}
                className={cn('flex w-full rounded-xl px-2.5 py-2.5 text-left hover:bg-subtle', !item.read && 'bg-primary-soft/40')}
              >
                <NotificationItem item={item} locale={locale} compact unreadLabel={t('notifications.unread')} />
              </button>
            ))}
          </div>
          <div className="border-t border-line p-1.5">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('/account/notifications');
              }}
              className="w-full rounded-xl px-3 py-2.5 text-center text-xs font-bold text-primary hover:bg-primary-soft"
            >
              {t('notifications.viewAll')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
