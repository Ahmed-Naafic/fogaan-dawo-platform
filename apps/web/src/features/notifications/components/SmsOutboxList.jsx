import { MessageSquareDashed } from 'lucide-react';
import Badge from '@/components/ui/Badge';
import { useI18n } from '@/lib/i18n';

/**
 * Simulated SMS messages (baseline: "write SMS messages to an in-app outbox"). Nothing is sent to a real
 * phone; this list is the outbox. `showUser` adds the recipient's name (admin view).
 */
export default function SmsOutboxList({ items, showUser = false }) {
  const { t, locale } = useI18n();
  if (!items.length) {
    return (
      <div className="card flex flex-col items-center p-8 text-center text-sm text-muted">
        <MessageSquareDashed className="mb-2 h-8 w-8" />
        {t('sms.empty')}
      </div>
    );
  }
  return (
    <ul className="space-y-2.5" data-sms-outbox>
      {items.map((m) => (
        <li key={m.id} className="card p-4" data-sms={m.id}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-muted">
            <span>
              {showUser && m.user ? `${m.user} · ` : ''}
              {m.recipient === 'in-app' ? t('sms.noPhone') : m.recipient}
            </span>
            <span className="flex items-center gap-2">
              <Badge tone={m.status === 'SENT' ? 'green' : m.status === 'FAILED' ? 'red' : 'neutral'}>{t(`sms.status.${m.status}`)}</Badge>
              {new Date(m.createdAt).toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </span>
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-sm">{m.message}</p>
        </li>
      ))}
    </ul>
  );
}
