import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Bell, ChevronRight, FolderHeart, KeyRound, Lock, Mail, Phone, ShieldCheck } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { CompletenessCard, ErrorState, Field, INVALID, LoadingCards, ProfilePhotoCard, ReadOnlyRow } from '../components/ProfileParts';
import { apiFieldErrors, dateOnly, patientForm, profileErrorKey, SEX_VALUES, validatePatientForm } from '../profileUi';
import { getPatientProfile, updatePatientProfile } from '../services/profileApi';

/** /patient/profile — the signed-in patient's own profile (personal data, emergency contact, account). */
export default function PatientProfilePage() {
  const { t, locale, setLang } = useI18n();
  const notify = useToast();
  const auth = useAuth();
  const [profile, setProfile] = useState(undefined); // undefined = loading, null = failed
  const [form, setForm] = useState(patientForm(null));
  const [invalid, setInvalid] = useState({});
  const [saving, setSaving] = useState(false);

  const apply = useCallback((p) => {
    setProfile(p);
    setForm(patientForm(p));
  }, []);

  const load = useCallback(() => {
    setProfile(undefined);
    getPatientProfile()
      .then(apply)
      .catch((error) => {
        setProfile(null);
        notify(t(profileErrorKey(error)), 'error');
      });
  }, [apply, notify, t]);

  useEffect(load, [load]);

  const set = (name) => (e) => {
    setForm((f) => ({ ...f, [name]: e.target.value }));
    if (invalid[name]) setInvalid((s) => ({ ...s, [name]: null }));
  };
  const props = (name, extra = {}) => ({ id: `pp-${name}`, name, value: form[name], onChange: set(name), 'aria-invalid': invalid[name] ? true : undefined, inputClassName: invalid[name] ? INVALID : undefined, ...extra });

  async function save(e) {
    e.preventDefault();
    const { errors, payload } = validatePatientForm(form, profile);
    if (!payload) {
      setInvalid(errors);
      notify(t(Object.values(errors)[0]), 'error');
      return;
    }
    if (!Object.keys(payload).length) {
      notify(t('profile.noChanges'), 'info');
      return;
    }
    setSaving(true);
    try {
      const saved = await updatePatientProfile(payload);
      apply(saved);
      setInvalid({});
      if (payload.preferredLanguage) setLang(payload.preferredLanguage);
      if (payload.fullName) await auth.reload().catch(() => {});
      notify(t('profile.saved'), 'success');
    } catch (error) {
      setInvalid(apiFieldErrors(error));
      notify(t(profileErrorKey(error)), 'error');
    } finally {
      setSaving(false);
    }
  }

  const header = <PageHeader title={t('profile.patient.title')} subtitle={t('profile.patient.subtitle')} />;
  if (profile === undefined) {
    return (
      <>
        {header}
        <LoadingCards />
      </>
    );
  }
  if (profile === null) {
    return (
      <>
        {header}
        <ErrorState onRetry={load} />
      </>
    );
  }

  const methods = profile.account.signInMethods;
  const verified = (ok) => <Badge tone={ok ? 'green' : 'neutral'}>{ok ? t('profile.verified') : t('profile.notVerified')}</Badge>;

  return (
    <>
      {header}
      <form className="grid gap-6 xl:grid-cols-[1.6fr_1fr]" onSubmit={save} noValidate data-patient-profile>
        <div className="min-w-0 space-y-6">
          <Card className="p-5 sm:p-6">
            <CardHeader title={t('profile.personal.title')} subtitle={t('profile.personal.subtitle')} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t('profile.fields.fullName')} error={invalid.fullName} htmlFor="pp-fullName" className="md:col-span-2" hint={profile.nameLocked ? t('profile.nameLocked') : null}>
                <Input {...props('fullName', { maxLength: 160, autoComplete: 'name', disabled: profile.nameLocked })} />
              </Field>
              <Field label={t('profile.fields.dateOfBirth')} error={invalid.dateOfBirth} htmlFor="pp-dateOfBirth" hint={t('profile.optionalHint')}>
                <Input type="date" {...props('dateOfBirth', { max: new Date().toISOString().slice(0, 10), min: '1900-01-01' })} />
              </Field>
              <Field label={t('profile.fields.sex')} htmlFor="pp-sex" hint={t('profile.optionalHint')}>
                <Select id="pp-sex" name="sex" value={form.sex} onChange={set('sex')}>
                  <option value="">{t('profile.sex.unset')}</option>
                  {SEX_VALUES.map((v) => (
                    <option key={v} value={v}>
                      {t(`profile.sex.${v}`)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('profile.fields.city')} error={invalid.city} htmlFor="pp-city" hint={t('profile.optionalHint')}>
                <Input {...props('city', { maxLength: 100, autoComplete: 'address-level2' })} />
              </Field>
              <Field label={t('profile.fields.addressLine')} error={invalid.addressLine} htmlFor="pp-addressLine" hint={t('profile.optionalHint')}>
                <Input {...props('addressLine', { maxLength: 255, autoComplete: 'street-address' })} />
              </Field>
              <Field label={t('profile.fields.preferredLanguage')} htmlFor="pp-preferredLanguage">
                <Select id="pp-preferredLanguage" name="preferredLanguage" value={form.preferredLanguage} onChange={set('preferredLanguage')}>
                  <option value="en">English</option>
                  <option value="so">Soomaali</option>
                </Select>
              </Field>
            </div>

            <div className="mt-6 rounded-xl border border-line bg-subtle/50 px-4">
              <ReadOnlyRow label={t('profile.fields.email')} value={profile.email ?? '—'} badge={profile.email ? verified(profile.emailVerified) : null} />
              <ReadOnlyRow label={t('profile.fields.phone')} value={profile.phone ?? '—'} badge={profile.phone ? verified(profile.phoneVerified) : null} />
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-2xs text-muted">
              <Lock className="h-3.5 w-3.5" /> {t('profile.contactReadOnly')}
            </p>
          </Card>

          <Card className="p-5 sm:p-6">
            <CardHeader title={t('profile.emergency.title')} subtitle={t('profile.emergency.subtitle')} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t('profile.fields.emergencyName')} error={invalid.emergencyName} htmlFor="pp-emergencyName">
                <Input {...props('emergencyName', { maxLength: 160 })} />
              </Field>
              <Field label={t('profile.fields.emergencyRelationship')} error={invalid.emergencyRelationship} htmlFor="pp-emergencyRelationship">
                <Input {...props('emergencyRelationship', { maxLength: 60, placeholder: t('profile.emergency.relationshipPlaceholder') })} />
              </Field>
              <Field label={t('profile.fields.emergencyPhone')} error={invalid.emergencyPhone} htmlFor="pp-emergencyPhone" hint={t('profile.phoneHint')} className="md:col-span-2">
                <Input type="tel" {...props('emergencyPhone', { maxLength: 32, icon: Phone, placeholder: '+252 61 234 5678', autoComplete: 'off' })} />
              </Field>
            </div>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving} data-save-profile>
              {saving ? t('auth.pleaseWait') : t('profile.save')}
            </Button>
          </div>

          <Link to="/patient/records" className="card flex items-center gap-4 p-5 transition-colors hover:bg-subtle/60">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <FolderHeart className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-ink">{t('medical.title')}</span>
              <span className="block text-xs text-muted">{t('profile.medicalLink', { count: profile.medicalHistoryCount })}</span>
            </span>
            <ChevronRight className="h-5 w-5 text-muted" />
          </Link>
        </div>

        <aside className="min-w-0 space-y-6">
          <ProfilePhotoCard name={profile.fullName} publicNote={t('profile.photo.privateNote')} />
          <CompletenessCard completeness={profile.completeness} scope="patient" />
          <Card className="p-5">
            <CardHeader title={t('profile.account.title')} />
            <div className="px-0.5">
              <ReadOnlyRow label={t('profile.account.created')} value={dateOnly(profile.account.createdAt, locale)} />
              <ReadOnlyRow label={t('profile.account.status')} value={<Badge tone={profile.account.status === 'ACTIVE' ? 'green' : 'neutral'}>{t(`profile.accountStatus.${profile.account.status}`)}</Badge>} />
              <ReadOnlyRow label={t('profile.account.roles')} value={profile.account.roles.map((r) => t(`roles.${r.toLowerCase()}`)).join(', ')} />
              <ReadOnlyRow
                label={t('profile.account.methods')}
                value={
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {methods?.password?.enabled && (
                      <Badge tone="teal" icon={KeyRound}>
                        {t('accountSecurity.password.title')}
                      </Badge>
                    )}
                    {methods?.google?.connected && (
                      <Badge tone="blue" icon={Mail}>
                        Google
                      </Badge>
                    )}
                  </span>
                }
              />
            </div>
            <div className="mt-4 grid gap-2">
              <Button variant="secondary" size="sm" to="/account/security">
                <ShieldCheck className="h-4 w-4" /> {t('accountSecurity.menu')}
              </Button>
              <Button variant="ghost" size="sm" to="/account/notifications">
                <Bell className="h-4 w-4" /> {t('notifications.title')}
              </Button>
            </div>
          </Card>
        </aside>
      </form>
    </>
  );
}
