import { useEffect, useRef, useState } from 'react';
import { FileText, Plus, SendHorizontal, Trash2, X } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import Tabs from '@/components/ui/Tabs';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

/*
 * Consultation side panel: patient info, notes and prescription draft, chat, files.
 * Phase 1: all edits are local component state — nothing is persisted.
 */

function ConsultationTab({ consult }) {
  const { t } = useI18n();
  const [notes, setNotes] = useState(() => t('consult.sampleNotes'));
  const [meds, setMeds] = useState([]);
  const p = consult.patient;
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-bold">{t('consult.patientInfo')}</h3>
        <div className="flex items-center gap-3.5">
          <Avatar src={p.avatar} name={p.name} size="lg" />
          <div className="text-sm">
            <p className="font-bold">{p.name}</p>
            <p className="text-xs text-muted">{t('consult.patientMeta', { gender: t(`gender.${p.gender}`), age: p.age })}</p>
            <p className="text-xs text-muted">ID: {p.id}</p>
          </div>
        </div>
      </section>
      <section className="border-t border-line pt-5">
        <label htmlFor="consult-notes" className="mb-2.5 block text-sm font-bold">
          {t('consult.notes')}
        </label>
        <Textarea id="consult-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
      </section>
      <section className="border-t border-line pt-5">
        <h3 className="mb-2.5 text-sm font-bold">{t('consult.prescription')}</h3>
        {meds.length > 0 && (
          <ul className="mb-3 space-y-2">
            {meds.map((m, i) => (
              <li key={m.id} className="flex items-center gap-2">
                <Input
                  value={m.name}
                  onChange={(e) => setMeds((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  placeholder={t('consult.medication')}
                  className="flex-1 [&_input]:h-10"
                  aria-label={t('consult.medication')}
                />
                <Input
                  value={m.dose}
                  onChange={(e) => setMeds((list) => list.map((x, j) => (j === i ? { ...x, dose: e.target.value } : x)))}
                  placeholder={t('consult.dosage')}
                  className="w-28 [&_input]:h-10"
                  aria-label={t('consult.dosage')}
                />
                <button onClick={() => setMeds((list) => list.filter((_, j) => j !== i))} className="rounded-lg p-2 text-muted hover:bg-subtle hover:text-danger" aria-label={t('common.remove')}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" className="w-full border-dashed" onClick={() => setMeds((l) => [...l, { id: Date.now(), name: '', dose: '' }])}>
          <Plus className="h-4 w-4" /> {t('consult.addPrescription')}
        </Button>
      </section>
    </div>
  );
}

function ChatTab({ consult }) {
  const { t } = useI18n();
  const [messages, setMessages] = useState(consult.chat);
  const [text, setText] = useState('');
  const endRef = useRef(null);
  // Block body: scrollIntoView() returns a Promise in current Chrome, and an effect must return nothing or a cleanup function.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);
  return (
    <div className="flex h-full flex-col">
      <ul className="flex-1 space-y-3 overflow-y-auto">
        {messages.map((m, i) => (
          <li key={i} className={cn('flex', m.from === 'patient' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[80%] rounded-2xl px-3.5 py-2 text-sm', m.from === 'patient' ? 'rounded-br-md bg-primary text-primary-fg' : 'rounded-bl-md bg-subtle')}>
              {m.text}
              <span className="mt-0.5 block text-right text-[10px] opacity-70">{m.time}</span>
            </div>
          </li>
        ))}
        <li ref={endRef} />
      </ul>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          const now = new Date();
          setMessages((list) => [...list, { from: 'patient', text: text.trim(), time: `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}` }]);
          setText('');
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('consult.typeMessage')} className="flex-1" aria-label={t('consult.typeMessage')} />
        <Button type="submit" size="icon" aria-label={t('consult.send')}>
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

function FilesTab({ consult }) {
  const { t } = useI18n();
  return (
    <ul className="space-y-2.5">
      {consult.files.map((f) => (
        <li key={f.name} className="flex items-center gap-3 rounded-xl border border-line p-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-rose-500 dark:bg-rose-400/10">
            <FileText className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{f.name}</p>
            <p className="text-2xs text-muted">{f.size}</p>
          </div>
        </li>
      ))}
      <li className="rounded-xl border border-dashed border-line p-4 text-center text-xs text-muted">{t('consult.filesNote')}</li>
    </ul>
  );
}

export default function ConsultationPanel({ consult, tab, setTab, onClose }) {
  const { t } = useI18n();
  return (
    <aside className="flex h-full flex-col bg-surface">
      <div className="flex items-center">
        <Tabs
          variant="underline"
          value={tab}
          onChange={setTab}
          className="flex-1 px-2"
          items={[
            { value: 'consultation', label: t('consult.tabs.consultation') },
            { value: 'chat', label: t('consult.tabs.chat') },
            { value: 'files', label: t('consult.tabs.files') },
          ]}
        />
        {onClose && (
          <button onClick={onClose} className="mr-2 rounded-lg p-2 text-muted hover:bg-subtle" aria-label={t('common.close')}>
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'consultation' && <ConsultationTab consult={consult} />}
        {tab === 'chat' && <ChatTab consult={consult} />}
        {tab === 'files' && <FilesTab consult={consult} />}
      </div>
    </aside>
  );
}
