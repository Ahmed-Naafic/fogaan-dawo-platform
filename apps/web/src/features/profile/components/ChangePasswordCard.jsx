import { useState } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n';
import { apiFieldErrors, profileErrorKey } from '../profileUi';
import { changePassword } from '../services/profileApi';
import { ConfirmDialog, Field, INVALID } from './ProfileParts';

const empty = { currentPassword: '', newPassword: '', newPasswordConfirmation: '' };

function validate(v) {
  const errors = {};
  if (!v.currentPassword) errors.currentPassword = 'security.errors.current';
  const bytes = new TextEncoder().encode(v.newPassword).length;
  if (v.newPassword.length < 8 || bytes > 72 || !/[A-Za-z]/.test(v.newPassword) || !/\d/.test(v.newPassword)) errors.newPassword = 'security.errors.strength';
  else if (v.newPassword === v.currentPassword) errors.newPassword = 'security.errors.same';
  if (v.newPasswordConfirmation !== v.newPassword) errors.newPasswordConfirmation = 'security.errors.mismatch';
  return errors;
}

/**
 * Change password (accounts that have one). Re-authenticates with the current password; on success the
 * API signs out every other session and keeps this one. Google-only accounts see why it is unavailable.
 */
export default function ChangePasswordCard({ hasPassword }) {
  const { t } = useI18n();
  const notify = useToast();
  const [values, setValues] = useState(empty);
  const [invalid, setInvalid] = useState({});
  const [show, setShow] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (name) => (e) => {
    setValues((v) => ({ ...v, [name]: e.target.value }));
    if (invalid[name]) setInvalid((s) => ({ ...s, [name]: null }));
  };

  const review = (e) => {
    e.preventDefault();
    const errors = validate(values);
    setInvalid(errors);
    if (!Object.keys(errors).length) setConfirming(true);
  };

  async function submit() {
    setBusy(true);
    try {
      const result = await changePassword(values);
      setValues(empty);
      setConfirming(false);
      notify(t('security.changed', { count: result.otherSessionsRevoked }), 'success');
    } catch (error) {
      setConfirming(false);
      setInvalid(apiFieldErrors(error));
      notify(t(profileErrorKey(error)), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!hasPassword) {
    return (
      <Card className="p-5 sm:p-6" data-change-password="unavailable">
        <CardHeader title={t('security.title')} />
        <p className="text-sm text-muted">{t('security.googleOnly')}</p>
      </Card>
    );
  }

  const input = (name, autoComplete) => (
    <Input
      id={`cp-${name}`}
      type={show ? 'text' : 'password'}
      value={values[name]}
      onChange={set(name)}
      autoComplete={autoComplete}
      maxLength={200}
      aria-invalid={invalid[name] ? true : undefined}
      inputClassName={invalid[name] ? INVALID : undefined}
    />
  );

  return (
    <Card className="p-5 sm:p-6" data-change-password>
      <CardHeader
        title={t('security.title')}
        subtitle={t('security.subtitle')}
        action={
          <Button variant="ghost" size="icon" onClick={() => setShow((s) => !s)} aria-label={t(show ? 'security.hide' : 'security.show')} aria-pressed={show}>
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        }
      />
      <form className="grid gap-4 md:grid-cols-2" onSubmit={review} noValidate>
        <Field label={t('security.current')} error={invalid.currentPassword} htmlFor="cp-currentPassword" className="md:col-span-2">
          {input('currentPassword', 'current-password')}
        </Field>
        <Field label={t('security.new')} error={invalid.newPassword} htmlFor="cp-newPassword" hint={t('security.rules')}>
          {input('newPassword', 'new-password')}
        </Field>
        <Field label={t('security.confirm')} error={invalid.newPasswordConfirmation} htmlFor="cp-newPasswordConfirmation">
          {input('newPasswordConfirmation', 'new-password')}
        </Field>
        <div className="flex justify-end md:col-span-2">
          <Button type="submit" variant="secondary" disabled={busy}>
            <KeyRound className="h-4 w-4" /> {t('security.submit')}
          </Button>
        </div>
      </form>
      {confirming && (
        <ConfirmDialog title={t('security.confirmTitle')} body={t('security.confirmBody')} confirmLabel={t('security.submit')} tone="primary" busy={busy} onCancel={() => setConfirming(false)} onConfirm={submit} />
      )}
    </Card>
  );
}
