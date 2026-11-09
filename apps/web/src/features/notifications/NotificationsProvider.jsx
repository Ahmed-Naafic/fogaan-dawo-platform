import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { openAuthenticatedStream } from '@/lib/apiClient';
import { useI18n } from '@/lib/i18n';
import { MESSAGES_CHANGED } from '@/features/messaging/services/messagingApi';
import * as api from './services/notificationApi';

/**
 * Live notification state for the signed-in user: unread count and the latest few items (for the bell).
 * Real-time: a Server-Sent Events stream (fetch + Bearer token; reconnects with backoff, and the server
 * closes it every 10 minutes so a fresh token is used). A 60-second poll of the unread count backs it up.
 */
const NotificationsContext = createContext(null);
export const NOTIFICATIONS_CHANGED = 'fd:notifications-changed';

function parseEvents(buffer, onEvent) {
  const parts = buffer.split('\n\n');
  const rest = parts.pop();
  for (const part of parts) {
    let event = 'message';
    let data = '';
    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (data) {
      try {
        onEvent(event, JSON.parse(data));
      } catch {
        /* ignore malformed event */
      }
    }
  }
  return rest;
}

export function NotificationsProvider({ children }) {
  const { lang } = useI18n();
  const [unreadCount, setUnreadCount] = useState(0);
  const [latest, setLatest] = useState(null); // null = not loaded yet
  const [live, setLive] = useState(false);
  const langRef = useRef(lang);
  langRef.current = lang;

  const refresh = useCallback(async () => {
    try {
      const page = await api.listNotifications({ lang: langRef.current, limit: 8 });
      setLatest(page.items);
      setUnreadCount(page.unreadCount);
    } catch {
      /* keep what we have */
    }
  }, []);

  // Initial load and whenever the language changes (text is rendered by the server per language).
  useEffect(() => {
    refresh();
  }, [refresh, lang]);

  // Real-time stream with reconnect.
  useEffect(() => {
    let stopped = false;
    let controller = null;
    let attempt = 0;
    const run = async () => {
      while (!stopped) {
        controller = new AbortController();
        try {
          const response = await openAuthenticatedStream(api.streamPath(langRef.current), { signal: controller.signal });
          attempt = 0;
          setLive(true);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer = parseEvents(buffer + decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n'), (event, data) => {
              if (typeof data.unreadCount === 'number') setUnreadCount(data.unreadCount);
              if (event === 'notification' && data.item) {
                setLatest((items) => [data.item, ...(items ?? []).filter((i) => i.id !== data.item.id)].slice(0, 8));
                window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED, { detail: data.item }));
              }
              if (event === 'sync') refresh();
              if (event === 'message' || event === 'message-read') window.dispatchEvent(new CustomEvent(MESSAGES_CHANGED, { detail: { type: event, ...data } }));
            });
          }
        } catch {
          /* network error, aborted or signed out */
        }
        setLive(false);
        if (stopped) break;
        attempt += 1;
        await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))));
      }
    };
    run();
    return () => {
      stopped = true;
      controller?.abort();
    };
  }, [refresh]);

  // Fallback poll (also catches up after the tab sleeps).
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') api.unreadCount().then((d) => setUnreadCount(d.unreadCount)).catch(() => {});
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  const value = useMemo(
    () => ({
      unreadCount,
      latest,
      live,
      refresh,
      setRead: async (id, read) => {
        const d = await api.setRead(id, read);
        setUnreadCount(d.unreadCount);
        setLatest((items) => items?.map((i) => (i.id === id ? { ...i, read } : i)) ?? items);
        window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED));
        return d;
      },
      readAll: async () => {
        const d = await api.readAll();
        setUnreadCount(d.unreadCount);
        setLatest((items) => items?.map((i) => ({ ...i, read: true })) ?? items);
        window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED));
        return d;
      },
      remove: async (id) => {
        const d = await api.deleteNotification(id);
        setUnreadCount(d.unreadCount);
        setLatest((items) => items?.filter((i) => i.id !== id) ?? items);
        window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED));
        return d;
      },
    }),
    [unreadCount, latest, live, refresh],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
