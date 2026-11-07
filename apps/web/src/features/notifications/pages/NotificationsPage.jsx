import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { BellRing, CheckCheck, Mail, MailOpen, Trash2 } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import Tabs from '@/components/ui/Tabs';
import Toggle from '@/components/ui/Toggle';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import NotificationItem from '../components/NotificationItem';
import { NOTIFICATIONS_CHANGED, useNotifications } from '../NotificationsProvider';
import { currentSubscription, disablePushOnThisDevice, enablePushOnThisDevice, pushPermission, pushSupported } from '../push';
import * as api from '../services/notificationApi';

function SettingRow({ title, body, children, testId }) {
  return (
    <div data-setting={testId} className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-bold text-ink">{title}</p>
        <div className="mt-0.5 text-xs leading-relaxed text-muted">{body}</div>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

/** Notification settings: optional in-app items, reminders, and push on this device. */
function NotificationSettings() {
  const { t } = useI18n();
  const notify = useToast();
  const [prefs, setPrefs] = useState(null);
  const [deviceOn, setDeviceOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getPreferences().then(setPrefs).catch(() => {});
    currentSubscription()
      .then((s) => setDeviceOn(Boolean(s)))
      .catch(() => {});
  }, []);

  const save = async (changes) => {
    setBusy(true);
    try {
      setPrefs(await api.updatePreferences(changes));
    } catch {
      notify(t('notifications.settings.saveFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const togglePush = async (on) => {
    setBusy(true);
    try {
      if (on) {
        setPrefs(await enablePushOnThisDevice(prefs.push.publicKey));
        setDeviceOn(true);
        notify(t('notifications.settings.pushEnabled'));
      } else {
        const next = await disablePushOnThisDevice();
        setDeviceOn(false);
        if (next) setPrefs(next);
        notify(t('notifications.settings.pushDisabled'));
      }
    } catch (error) {
      notify(t(error.code === 'PUSH_DENIED' ? 'notifications.settings.pushDenied' : 'notifications.settings.pushFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  let pushBody = t('notifications.settings.pushBody');
  let pushControl = null;
  if (prefs && !prefs.push.available) pushBody = t('notifications.settings.pushUnavailable');
  else if (!pushSupported()) pushBody = t('notifications.settings.pushUnsupported');
  else if (pushPermission() === 'denied') pushBody = t('notifications.settings.pushBlocked');
  else if (prefs) pushControl = <Toggle checked={deviceOn} onChange={(v) => !busy && togglePush(v)} label={t('notifications.settings.pushTitle')} />;

  return (
    <Card className="p-5 sm:p-6" data-notification-settings>
      <CardHeader title={t('notifications.settings.title')} subtitle={t('notifications.settings.subtitle')} />
      {!prefs ? (
        <div className="h-32 animate-pulse rounded-xl bg-subtle" />
      ) : (
        <div className="divide-y divide-line">
          <SettingRow testId="essential" title={t('notifications.settings.essentialTitle')} body={t('notifications.settings.essentialBody')}>
            <Badge tone="green">{t('notifications.settings.alwaysOn')}</Badge>
          </SettingRow>
          <SettingRow testId="in-app" title={t('notifications.settings.inAppTitle')} body={t('notifications.settings.inAppBody')}>
            <Toggle checked={prefs.inAppEnabled} onChange={(v) => !busy && save({ inAppEnabled: v })} label={t('notifications.settings.inAppTitle')} />
          </SettingRow>
          <SettingRow testId="reminders" title={t('notifications.settings.remindersTitle')} body={t('notifications.settings.remindersBody')}>
            <Toggle checked={prefs.remindersEnabled} onChange={(v) => !busy && save({ remindersEnabled: v })} label={t('notifications.settings.remindersTitle')} />
          </SettingRow>
          <SettingRow
            testId="push"
            title={t('notifications.settings.pushTitle')}
            body={
              <>
                {pushBody}
                {prefs.push.devices > 0 && <span className="mt-1 block">{t('notifications.settings.devices', { count: prefs.push.devices })}</span>}
              </>
            }
          >
            {pushControl}
          </SettingRow>
          {prefs.pushEnabled && (
            <SettingRow testId="push-account" title={t('notifications.settings.pushAccountTitle')} body={t('notifications.settings.pushAccountBody')}>
              <Toggle checked={prefs.pushEnabled} onChange={(v) => !busy && save({ pushEnabled: v })} label={t('notifications.settings.pushAccountTitle')} />
            </SettingRow>
          )}
        </div>
      )}
    </Card>
  );
}

/** Notification center: full history with read/unread, delete, mark all read and "load more". */
export default function NotificationsPage() {
  const { t, lang, locale } = useI18n();
  const notify = useToast();
  const navigate = useNavigate();
  const live = useNotifications();
  const [tab, setTab] = useState('all');
  const [items, setItems] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(() => {
    api
      .listNotifications({ lang, unread: tab === 'unread', limit: 20 })
      .then((page) => {
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch(() => setItems([]));
  }, [lang, tab]);

  useEffect(() => {
    setItems(null);
    load();
  }, [load]);

  // New notifications (real-time) appear at the top.
  useEffect(() => {
    const onChange = (e) => {
      if (e.detail) setItems((list) => (list ? [e.detail, ...list.filter((i) => i.id !== e.detail.id)] : list));
    };
    window.addEventListener(NOTIFICATIONS_CHANGED, onChange);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, onChange);
  }, []);

  const more = async () => {
    setLoadingMore(true);
    try {
      const page = await api.listNotifications({ lang, unread: tab === 'unread', cursor, limit: 20 });
      setItems((list) => [...list, ...page.items.filter((i) => !list.some((x) => x.id === i.id))]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const act = async (fn, after) => {
    try {
      await fn();
      after();
    } catch {
      notify(t('notifications.actionFailed'), 'error');
    }
  };
  const toggleRead = (item) =>
    act(
      () => live.setRead(item.id, !item.read),
      () => setItems((list) => (tab === 'unread' && !item.read ? list.filter((i) => i.id !== item.id) : list.map((i) => (i.id === item.id ? { ...i, read: !item.read } : i)))),
    );
  const remove = (item) => act(() => live.remove(item.id), () => setItems((list) => list.filter((i) => i.id !== item.id)));
  const readAll = () => act(() => live.readAll(), () => setItems((list) => (tab === 'unread' ? [] : list.map((i) => ({ ...i, read: true })))));

  return (
    <>
      <PageHeader title={t('notifications.title')} subtitle={t('notifications.subtitle')} />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <Tabs
              value={tab}
              onChange={setTab}
              className="p-1"
              items={[
                { value: 'all', label: t('notifications.tabs.all') },
                { value: 'unread', label: `${t('notifications.tabs.unread')}${live?.unreadCount ? ` (${live.unreadCount})` : ''}` },
              ]}
            />
            <Button variant="secondary" size="sm" onClick={readAll} disabled={!live?.unreadCount}>
              <CheckCheck className="h-4 w-4" /> {t('notifications.markAllRead')}
            </Button>
          </div>

          {items === null && (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl bg-subtle" />
              ))}
            </div>
          )}
          {items?.length === 0 && (
            <div className="flex flex-col items-center px-4 py-14 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                <BellRing className="h-7 w-7" />
              </span>
              <p className="mt-4 text-sm font-bold">{t(tab === 'unread' ? 'notifications.emptyUnread' : 'notifications.empty')}</p>
            </div>
          )}
          {items?.length > 0 && (
            <ul className="divide-y divide-line" data-notification-list>
              {items.map((item) => (
                <li key={item.id} data-notification={item.id} data-read={item.read} className={cn('flex flex-col gap-2 py-3 sm:flex-row sm:items-center', !item.read && '-mx-2 rounded-xl bg-primary-soft/40 px-2')}>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 text-left"
                    onClick={() => {
                      if (!item.read) live.setRead(item.id, true).catch(() => {});
                      navigate(item.url);
                    }}
                  >
                    <NotificationItem item={item} locale={locale} unreadLabel={t('notifications.unread')} />
                  </button>
                  <div className="flex shrink-0 gap-1 self-end sm:self-center">
                    <button type="button" onClick={() => toggleRead(item)} className="rounded-lg p-2 text-muted hover:bg-subtle hover:text-ink" aria-label={t(item.read ? 'notifications.markUnread' : 'notifications.markRead')} title={t(item.read ? 'notifications.markUnread' : 'notifications.markRead')}>
                      {item.read ? <Mail className="h-4 w-4" /> : <MailOpen className="h-4 w-4" />}
                    </button>
                    <button type="button" onClick={() => remove(item)} className="rounded-lg p-2 text-muted hover:bg-subtle hover:text-danger" aria-label={t('notifications.delete')} title={t('notifications.delete')}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {cursor && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" size="sm" onClick={more} disabled={loadingMore}>
                {t('notifications.loadMore')}
              </Button>
            </div>
          )}
        </Card>

        <NotificationSettings />
      </div>
    </>
  );
}
