import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, CheckCheck, FileImage, FileText, Loader2, Paperclip, Send } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { getConversation, markRead, MESSAGES_CHANGED, messagingErrorKey, sendMessage } from '@/features/messaging/services/messagingApi';
import { listConsultationDocuments, downloadDocument } from '@/features/prescriptions/services/prescriptionApi';
import { openBlob, rxErrorKey } from '@/features/prescriptions/prescriptionUi';
import { uploadViaStaging, declaredType } from '@/lib/stagedFiles';
import { apiRequest } from '@/lib/apiClient';

/** Requirement 8: images or PDFs up to 5 MB in the in-call chat (the API enforces the same limit). */
export const CHAT_FILE_MAX_BYTES = 5 * 1024 * 1024;
const CHAT_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
const POLL_MS = 8_000;

const uploadChatFile = (consultationId, file) =>
  uploadViaStaging(file, {
    initiate: (declared) =>
      apiRequest(`/v1/consultations/${encodeURIComponent(consultationId)}/documents/upload-url`, { method: 'POST', body: { ...declared, context: 'CHAT', category: declared.contentType === 'application/pdf' ? 'MEDICAL_REPORT' : 'SCANNED_DOCUMENT', description: 'Shared in the consultation chat' } }),
    finalize: (uploadToken) => apiRequest(`/v1/consultations/${encodeURIComponent(consultationId)}/documents/finalize`, { method: 'POST', body: { uploadToken } }),
  });

/**
 * In-call chat beside the video (requirement 8): text messages plus image/PDF files, both saved to the
 * consultation record (messages carry the consultation id; files are consultation documents).
 * Messages are stored on the server, so anything sent while the other side is reconnecting is shown as
 * soon as they are back: the panel reloads on live message events, when the browser comes back online,
 * and every few seconds while open.
 */
export default function CallChat({ appointmentId, consultationId }) {
  const { t, locale } = useI18n();
  const notify = useToast();
  const [messages, setMessages] = useState([]);
  const [files, setFiles] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const fileInput = useRef(null);
  const bottom = useRef(null);

  const load = useCallback(async () => {
    const [conv, docs] = await Promise.all([getConversation(appointmentId).catch(() => null), consultationId ? listConsultationDocuments(consultationId).catch(() => null) : null]);
    if (conv) {
      setMessages(conv.messages);
      if (conv.messages.some((m) => !m.mine && !m.readAt)) markRead(appointmentId).catch(() => {});
    }
    if (docs) setFiles(docs.items);
    setLoaded(true);
  }, [appointmentId, consultationId]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    window.addEventListener(MESSAGES_CHANGED, load);
    window.addEventListener('online', load);
    return () => {
      clearInterval(id);
      window.removeEventListener(MESSAGES_CHANGED, load);
      window.removeEventListener('online', load);
    };
  }, [load]);

  const timeline = [...messages.map((m) => ({ kind: 'message', at: m.createdAt, m })), ...files.map((d) => ({ kind: 'file', at: d.createdAt, d }))].sort((a, b) => a.at.localeCompare(b.at));
  // Braces matter: scrollIntoView returns a Promise in recent browsers, and an effect must not return one.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [timeline.length]);

  const send = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      const m = await sendMessage(appointmentId, body);
      setMessages((list) => [...list, m]);
      setText('');
    } catch (error) {
      notify(t(messagingErrorKey(error)), 'error');
    } finally {
      setSending(false);
    }
  };

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['application/pdf', 'image/jpeg', 'image/png'].includes(declaredType(file))) return notify(t('consult.chat.fileType'), 'error');
    if (file.size > CHAT_FILE_MAX_BYTES) return notify(t('consult.chat.fileTooLarge'), 'error');
    if (!consultationId) return notify(t('consult.panelBeforeJoin'), 'error');
    setUploading(true);
    try {
      await uploadChatFile(consultationId, file);
      await load();
    } catch (error) {
      notify(t(error?.code === 'PAYLOAD_TOO_LARGE' || error?.status === 413 ? 'consult.chat.fileTooLarge' : rxErrorKey(error)), 'error');
    } finally {
      setUploading(false);
    }
  };

  const time = (iso) => new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="flex h-full min-h-[22rem] flex-col" data-call-chat>
      <div className="flex-1 space-y-2 overflow-y-auto" aria-live="polite">
        {loaded && timeline.length === 0 && <p className="py-8 text-center text-sm text-muted">{t('consult.chat.empty')}</p>}
        {timeline.map((item) =>
          item.kind === 'message' ? (
            <div key={`m-${item.m.id}`} className={cn('flex', item.m.mine ? 'justify-end' : 'justify-start')} data-chat-message>
              <div className={cn('max-w-[85%] rounded-2xl px-3 py-1.5 text-sm', item.m.mine ? 'rounded-br-md bg-primary text-primary-fg' : 'rounded-bl-md bg-subtle text-ink')}>
                <p className="whitespace-pre-wrap break-words">{item.m.body}</p>
                <p className={cn('mt-0.5 flex items-center justify-end gap-1 text-[10px]', item.m.mine ? 'text-primary-fg/75' : 'text-muted')}>
                  {time(item.m.createdAt)}
                  {item.m.mine && (item.m.readAt ? <CheckCheck className="h-3 w-3" aria-label={t('messages.seen')} /> : <Check className="h-3 w-3" aria-label={t('messages.sent')} />)}
                </p>
              </div>
            </div>
          ) : (
            <div key={`f-${item.d.id}`} className={cn('flex', item.d.uploadedBy.isMe ? 'justify-end' : 'justify-start')} data-chat-file>
              <button
                type="button"
                onClick={() => openBlob(() => downloadDocument(item.d.id), { fileName: item.d.fileName }).catch((err) => notify(t(rxErrorKey(err)), 'error'))}
                className="flex max-w-[85%] items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2 text-left text-xs hover:border-primary/50"
              >
                {item.d.mimeType === 'application/pdf' ? <FileText className="h-5 w-5 shrink-0 text-primary" /> : <FileImage className="h-5 w-5 shrink-0 text-primary" />}
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{item.d.fileName}</span>
                  <span className="text-[10px] text-muted">{time(item.d.createdAt)}</span>
                </span>
              </button>
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>
      <form onSubmit={send} className="mt-3 flex items-end gap-2 border-t border-line pt-3">
        <input ref={fileInput} type="file" accept={CHAT_ACCEPT} className="hidden" onChange={pick} data-chat-file-input />
        <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} className="rounded-xl p-2.5 text-muted hover:bg-subtle" aria-label={t('consult.chat.attach')} title={t('consult.chat.attach')}>
          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
        </button>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) send(e);
          }}
          rows={1}
          maxLength={2000}
          placeholder={t('messages.placeholder')}
          aria-label={t('messages.placeholder')}
          className="min-h-[2.75rem] flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-sm focus:border-primary focus:outline-none"
        />
        <button type="submit" disabled={sending || !text.trim()} className="rounded-xl bg-primary p-2.5 text-primary-fg disabled:opacity-50" aria-label={t('messages.send')}>
          <Send className="h-5 w-5" />
        </button>
      </form>
      <p className="mt-1.5 text-[10px] text-muted">{t('consult.chat.note')}</p>
    </div>
  );
}
