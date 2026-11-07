import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Circle, ImageUp, Trash2 } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { Dialog } from '@/features/appointments/components/AppointmentDialogs';
import { useAuth } from '@/features/auth/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { checkPhotoFile, PHOTO_ACCEPT, profileErrorKey } from '../profileUi';
import { removeMyPhoto, uploadMyPhoto } from '../services/profileApi';
import useOwnPhoto from '../useOwnPhoto';

export const INVALID = 'border-danger/70 focus:border-danger focus:ring-danger/10';

export function Field({ label, error, hint, children, className, htmlFor }) {
  const { t } = useI18n();
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-2xs font-medium text-danger" role="alert">
          {t(error)}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-2xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/** Read-only value row (email, phone, account data). */
export function ReadOnlyRow({ label, value, badge }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3 last:border-0">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
        <span className="truncate">{value}</span>
        {badge}
      </span>
    </div>
  );
}

export function LoadingCards() {
  return (
    <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]" aria-busy="true">
      <div className="space-y-6">
        <div className="card h-56 animate-pulse" />
        <div className="card h-72 animate-pulse" />
      </div>
      <div className="card h-64 animate-pulse" />
    </div>
  );
}

export function ErrorState({ onRetry }) {
  const { t } = useI18n();
  return (
    <Card className="p-6 text-center" role="alert">
      <p className="text-sm text-muted">{t('profile.loadFailed')}</p>
      <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
        {t('profile.retry')}
      </Button>
    </Card>
  );
}

/** Informational completeness indicator; never gates anything. `scope` = 'patient' | 'doctor'. */
export function CompletenessCard({ completeness, scope }) {
  const { t } = useI18n();
  if (!completeness) return null;
  return (
    <Card className="p-5">
      <CardHeader title={t('profile.completeness.title')} subtitle={t('profile.completeness.hint')} />
      <div className="flex items-center gap-3">
        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completeness.percent} aria-label={t('profile.completeness.title')}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${completeness.percent}%` }} />
        </div>
        <span className="text-sm font-bold text-ink" data-completeness={completeness.percent}>
          {completeness.percent}%
        </span>
      </div>
      <ul className="mt-4 space-y-2">
        {completeness.items.map((item) => (
          <li key={item.key} className="flex items-center gap-2 text-sm">
            {item.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : <Circle className="h-4 w-4 shrink-0 text-muted" />}
            <span className={cn(item.done ? 'text-ink' : 'text-muted')}>{t(`profile.completeness.items.${scope}.${item.key}`)}</span>
            {!item.required && <span className="text-2xs text-muted">· {t('profile.optional')}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Generic confirmation for sensitive actions. */
export function ConfirmDialog({ title, body, confirmLabel, tone = 'danger', busy, onCancel, onConfirm, children }) {
  const { t } = useI18n();
  return (
    <Dialog title={title} onClose={onCancel} busy={busy} labelledBy="profile-confirm-title">
      <div className="space-y-4">
        {body && <p className="text-sm leading-relaxed text-muted">{body}</p>}
        {children}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy} data-confirm>
            {busy ? t('auth.pleaseWait') : confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Upload / preview / replace / remove the own profile photo. The preview shows the chosen file
 * locally; nothing is stored until "Save photo". `publicNote` explains where the photo is visible.
 */
export function ProfilePhotoCard({ name, publicNote }) {
  const { t } = useI18n();
  const notify = useToast();
  const auth = useAuth();
  const current = useOwnPhoto();
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null); // 'upload' | 'remove'
  const [confirmRemove, setConfirmRemove] = useState(false);
  const hasPhoto = Boolean(auth.session?.user?.photoUpdatedAt);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  const choose = (f) => {
    if (!f) return;
    const problem = checkPhotoFile(f);
    if (problem) {
      notify(t(problem), 'error');
      if (input.current) input.current.value = '';
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };
  const reset = () => {
    setFile(null);
    setPreview(null);
    if (input.current) input.current.value = '';
  };

  async function save() {
    setBusy('upload');
    try {
      await uploadMyPhoto(file);
      await auth.reload();
      reset();
      notify(t('profile.photo.saved'), 'success');
    } catch (error) {
      notify(t(profileErrorKey(error)), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('remove');
    try {
      await removeMyPhoto();
      await auth.reload();
      setConfirmRemove(false);
      notify(t('profile.photo.removed'), 'success');
    } catch (error) {
      notify(t(profileErrorKey(error)), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <CardHeader title={t('profile.photo.title')} subtitle={publicNote} />
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
        <Avatar src={preview ?? current} name={name} size="xl" ring className="h-24 w-24 text-2xl" />
        <div className="w-full min-w-0 flex-1 space-y-3 text-center sm:text-left">
          <p className="text-2xs text-muted">{t('profile.photo.rules')}</p>
          <input ref={input} type="file" accept={PHOTO_ACCEPT} className="sr-only" id="profile-photo-input" data-photo-input onChange={(e) => choose(e.target.files?.[0])} />
          {file ? (
            <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
              <Button size="sm" onClick={save} disabled={busy !== null} data-photo-save>
                <ImageUp className="h-4 w-4" /> {busy === 'upload' ? t('auth.pleaseWait') : t('profile.photo.save')}
              </Button>
              <Button size="sm" variant="secondary" onClick={reset} disabled={busy !== null}>
                {t('common.cancel')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
              <Button size="sm" variant="soft" onClick={() => input.current?.click()} disabled={busy !== null}>
                <Camera className="h-4 w-4" /> {hasPhoto ? t('profile.photo.replace') : t('profile.photo.upload')}
              </Button>
              {hasPhoto && (
                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)} disabled={busy !== null} data-photo-remove>
                  <Trash2 className="h-4 w-4" /> {t('profile.photo.remove')}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      {confirmRemove && (
        <ConfirmDialog
          title={t('profile.photo.removeTitle')}
          body={t('profile.photo.removeBody')}
          confirmLabel={t('profile.photo.remove')}
          busy={busy === 'remove'}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={remove}
        />
      )}
    </Card>
  );
}
