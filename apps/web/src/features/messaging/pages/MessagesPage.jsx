import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, CalendarDays, Check, CheckCheck, Lock, MessageSquareText, Send } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { specialtyName } from '@/features/doctors/doctorApplicationForm';
import usePrivateImage from '@/features/profile/usePrivateImage';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { browserTimeZone, formatDateTime, formatTime } from '@/lib/timezone';
import * as api from '../services/messagingApi';
import { MESSAGES_CHANGED, messagingErrorKey } from '../services/messagingApi';

export const MAX_MESSAGE = 2000;

/** Calls `fn` whenever the notification stream reports a message event (optionally for one conversation). */
function useMessageEvents(fn, appointmentId = null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const on = (e) => (!appointmentId || e.detail?.appointmentId === appointmentId) && ref.current(e.detail);
    window.addEventListener(MESSAGES_CHANGED, on);
    return () => window.removeEventListener(MESSAGES_CHANGED, on);
  }, [appointmentId]);
}

function CounterpartAvatar({ person, size = 'md' }) {
  const photo = usePrivateImage(person.photoUrl);
  return <Avatar src={photo} name={person.name} size={size} className="ring-2 ring-primary-soft" />;
}

function ConversationList({ items, activeId, base }) {
  const { t, lang, locale } = useI18n();
  const tz = browserTimeZone();
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center px-6 py-14 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
          <MessageSquareText className="h-7 w-7" />
        </span>
        <p className="mt-4 max-w-xs text-sm text-muted">{t('messages.empty')}</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-line" aria-label={t('messages.conversations')}>
      {items.map((c) => (
        <li key={c.appointmentId}>
          <Link
            to={`${base}/${c.appointmentId}`}
            className={cn('flex items-center gap-3 px-4 py-3 transition-colors hover:bg-subtle/60', c.appointmentId === activeId && 'bg-primary-soft/60')}
            aria-current={c.appointmentId === activeId ? 'page' : undefined}
            data-conversation={c.appointmentId}
          >
            <CounterpartAvatar person={c.counterpart} />
            <div className="min-w-0 flex-1">
              <p className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-bold">{c.counterpart.name}</span>
                {c.lastMessage && <span className="shrink-0 text-2xs text-muted">{formatDateTime(c.lastMessage.createdAt, tz, locale)}</span>}
              </p>
              <p className={cn('truncate text-xs', c.unread ? 'font-semibold text-ink' : 'text-muted')}>
                {c.lastMessage ? `${c.lastMessage.mine ? `${t('messages.you')}: ` : ''}${c.lastMessage.body}` : c.counterpart.specialty ? specialtyName(c.counterpart.specialty, lang) : t('messages.noMessagesYet')}
              </p>
            </div>
            {c.unread > 0 ? <Badge tone="red">{c.unread}</Badge> : !c.open && <Lock className="h-3.5 w-3.5 shrink-0 text-muted" aria-label={t('messages.closed')} />}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Thread({ appointmentId, base, viewer, onChanged }) {
  const { t, lang, locale } = useI18n();
  const tz = browserTimeZone();
  const notify = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const bottom = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await api.getConversation(appointmentId);
      setData((prev) => ({ ...d, messages: prev && prev.conversation.appointmentId === appointmentId ? mergeMessages(prev.messages, d.messages) : d.messages, hasMore: prev?.conversation.appointmentId === appointmentId ? prev.hasMore : d.hasMore }));
      setError(null);
      if (d.conversation.unread > 0) {
        await api.markRead(appointmentId).catch(() => {});
        onChanged();
      }
    } catch (e) {
      setError(e);
    }
  }, [appointmentId, onChanged]);

  useEffect(() => {
    setData(null);
    setDraft('');
    load();
  }, [appointmentId, load]);

  useMessageEvents(() => load(), appointmentId);

  const count = data?.messages.length ?? 0;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [count]);

  const older = async () => {
    setLoadingOlder(true);
    try {
      const d = await api.getConversation(appointmentId, data.messages[0]?.id);
      setData((prev) => ({ ...prev, messages: mergeMessages(d.messages, prev.messages), hasMore: d.hasMore }));
    } catch (e) {
      notify(t(messagingErrorKey(e)), 'error');
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = async (e) => {
    e?.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const m = await api.sendMessage(appointmentId, body);
      setDraft('');
      setData((prev) => ({ ...prev, messages: mergeMessages(prev.messages, [m]) }));
      onChanged();
    } catch (err) {
      notify(t(messagingErrorKey(err)), 'error');
      if (err?.code === 'CONVERSATION_CLOSED') load();
    } finally {
      setSending(false);
    }
  };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted" role="alert">
        {t(messagingErrorKey(error))}
      </div>
    );
  }
  if (!data) return <div className="h-full min-h-[420px] animate-pulse" aria-busy="true" />;
  const c = data.conversation;
  const appointmentHref = `/${viewer === 'DOCTOR' ? 'doctor' : 'patient'}/appointments/${c.appointmentId}`;

  return (
    <div className="flex h-full min-h-[420px] flex-col" data-thread={c.appointmentId}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <button type="button" onClick={() => navigate(base)} className="-ml-1 rounded-lg p-1.5 text-muted hover:bg-subtle lg:hidden" aria-label={t('messages.back')}>
          <ArrowLeft className="h-5 w-5" />
        </button>
        <CounterpartAvatar person={c.counterpart} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{c.counterpart.name}</p>
          <Link to={appointmentHref} className="inline-flex items-center gap-1 text-2xs text-muted hover:text-primary">
            <CalendarDays className="h-3 w-3" /> {t('messages.aboutAppointment', { when: formatDateTime(c.startAtUtc, tz, locale) })}
            {c.counterpart.specialty && ` · ${specialtyName(c.counterpart.specialty, lang)}`}
          </Link>
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4" aria-live="polite">
        {data.hasMore && (
          <div className="text-center">
            <Button variant="secondary" size="sm" onClick={older} disabled={loadingOlder}>
              {t('messages.older')}
            </Button>
          </div>
        )}
        {data.messages.length === 0 && <p className="py-10 text-center text-sm text-muted">{t(c.open ? 'messages.startHint' : 'messages.noMessagesYet')}</p>}
        {data.messages.map((m) => (
          <div key={m.id} className={cn('flex', m.mine ? 'justify-end' : 'justify-start')} data-message={m.id}>
            <div className={cn('max-w-[80%] rounded-2xl px-3.5 py-2 text-sm', m.mine ? 'rounded-br-md bg-primary text-primary-fg' : 'rounded-bl-md bg-subtle text-ink')}>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className={cn('mt-0.5 flex items-center justify-end gap-1 text-[10px]', m.mine ? 'text-primary-fg/75' : 'text-muted')}>
                {formatTime(m.createdAt, tz, locale)}
                {m.mine && (m.readAt ? <CheckCheck className="h-3 w-3" aria-label={t('messages.seen')} /> : <Check className="h-3 w-3" aria-label={t('messages.sent')} />)}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {c.open ? (
        <form onSubmit={send} className="border-t border-line p-3">
          <div className="flex items-end gap-2">
            <Textarea
              rows={1}
              value={draft}
              maxLength={MAX_MESSAGE}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) send(e);
              }}
              placeholder={t('messages.placeholder')}
              aria-label={t('messages.placeholder')}
              className="min-h-[44px] flex-1 resize-none py-2.5"
              name="message"
            />
            <Button type="submit" disabled={sending || !draft.trim()} aria-label={t('messages.send')} className="h-11 shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-1.5 text-2xs text-muted">
            {c.closesAt ? t('messages.closesOn', { when: formatDateTime(c.closesAt, tz, locale) }) : t('messages.notEmergency')}
          </p>
        </form>
      ) : (
        <p className="flex items-center justify-center gap-2 border-t border-line px-4 py-3 text-xs text-muted" role="note">
          <Lock className="h-3.5 w-3.5" /> {t('messages.closedNote')}
        </p>
      )}
    </div>
  );
}

/** Merge two message lists by id, ordered by time (new page, live update or the message just sent). */
export function mergeMessages(a, b) {
  const byId = new Map([...a, ...b].map((m) => [m.id, m]));
  return [...byId.values()].sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id));
}

/** /patient/messages and /doctor/messages — conversations of paid appointments; :appointmentId opens one. */
export default function MessagesPage({ viewer = 'PATIENT' }) {
  const { t } = useI18n();
  const { appointmentId } = useParams();
  const base = viewer === 'DOCTOR' ? '/doctor/messages' : '/patient/messages';
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);

  const loadList = useCallback(() => {
    api
      .listConversations()
      .then((d) => {
        setList(d);
        setError(null);
      })
      .catch(setError);
  }, []);
  useEffect(loadList, [loadList]);
  useMessageEvents(loadList);
  const changed = useCallback(() => {
    loadList();
    window.dispatchEvent(new CustomEvent(MESSAGES_CHANGED, { detail: { type: 'local' } }));
  }, [loadList]);

  return (
    <>
      <PageHeader title={t('messages.title')} subtitle={t(viewer === 'DOCTOR' ? 'messages.subtitleDoctor' : 'messages.subtitlePatient', { days: list?.windowDays ?? 7 })} back={viewer === 'DOCTOR' ? '/doctor' : '/patient'} />
      <Card className="grid overflow-hidden lg:h-[calc(100vh-220px)] lg:min-h-[520px] lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className={cn('border-line lg:block lg:overflow-y-auto lg:border-r', appointmentId && 'hidden')}>
          {error ? (
            <p className="p-6 text-sm text-danger" role="alert">
              {t(messagingErrorKey(error))}
            </p>
          ) : !list ? (
            <div className="space-y-3 p-4" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-subtle" />
              ))}
            </div>
          ) : (
            <ConversationList items={list.items} activeId={appointmentId} base={base} />
          )}
        </div>
        <div className={cn('lg:block', !appointmentId && 'hidden')}>
          {appointmentId ? (
            <Thread appointmentId={appointmentId} base={base} viewer={viewer} onChanged={changed} />
          ) : (
            <div className="hidden h-full items-center justify-center p-8 text-center text-sm text-muted lg:flex">{t('messages.pick')}</div>
          )}
        </div>
      </Card>
    </>
  );
}
