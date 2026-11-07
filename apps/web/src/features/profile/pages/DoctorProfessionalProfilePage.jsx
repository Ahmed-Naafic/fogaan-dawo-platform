import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, BadgeCheck, CalendarClock, DollarSign, ExternalLink, FileText, Lock, RefreshCw, ShieldCheck } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Input';
import Tabs from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import { getMyAvailability } from '@/features/availability/services/availabilityApi';
import { ApplicationStatusBadge } from '@/features/doctors/components/ApplicationParts';
import { ACCEPTED_FILES, checkFile, LANGUAGES, specialtyName } from '@/features/doctors/doctorApplicationForm';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { CompletenessCard, ConfirmDialog, ErrorState, Field, INVALID, LoadingCards, ProfilePhotoCard, ReadOnlyRow } from '../components/ProfileParts';
import { apiFieldErrors, dateOnly, doctorForm, profileErrorKey, validateDoctorForm } from '../profileUi';
import { getDoctorProfile, replaceLicence, updateDoctorProfile } from '../services/profileApi';

const LICENCE_NUMBER = /^[A-Za-z0-9][A-Za-z0-9 ./-]*$/;
const LICENCE_COUNTRY = /^[\p{L}][\p{L} .'-]*$/u;

/** Replace licence → Option A re-verification. Explicit acknowledgement required. */
function ReplaceLicenceDialog({ profile, onCancel, onDone }) {
  const { t } = useI18n();
  const notify = useToast();
  const [file, setFile] = useState(null);
  const [number, setNumber] = useState(profile.licenceNumber ?? '');
  const [country, setCountry] = useState(profile.licenceCountry ?? '');
  const [ack, setAck] = useState(false);
  const [invalid, setInvalid] = useState({});
  const [busy, setBusy] = useState(false);

  async function confirm() {
    const errors = {};
    if (!file) errors.file = 'myDoctorProfile.errors.file';
    else if (checkFile(file)) errors.file = checkFile(file);
    if (number.trim().length < 3 || number.trim().length > 60 || !LICENCE_NUMBER.test(number.trim())) errors.number = 'myDoctorProfile.errors.licenceNumber';
    if (country.trim().length < 2 || country.trim().length > 100 || !LICENCE_COUNTRY.test(country.trim())) errors.country = 'myDoctorProfile.errors.licenceCountry';
    if (!ack) errors.ack = 'myDoctorProfile.errors.ack';
    setInvalid(errors);
    if (Object.keys(errors).length) return;
    setBusy(true);
    try {
      const result = await replaceLicence(file, { licenceNumber: number.trim(), licenceCountry: country.trim() });
      onDone(result);
    } catch (error) {
      notify(t(profileErrorKey(error)), 'error');
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog title={t('myDoctorProfile.licence.replaceTitle')} confirmLabel={t('myDoctorProfile.licence.replaceConfirm')} busy={busy} onCancel={onCancel} onConfirm={confirm}>
      <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-3.5 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200" role="note">
        <p className="flex items-center gap-2 font-bold">
          <AlertTriangle className="h-4 w-4" /> {t('myDoctorProfile.licence.warningTitle')}
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>{t('myDoctorProfile.licence.warning1')}</li>
          <li>{t('myDoctorProfile.licence.warning2')}</li>
          <li>{t('myDoctorProfile.licence.warning3')}</li>
          <li>{t('myDoctorProfile.licence.warning4')}</li>
        </ul>
      </div>
      <Field label={t('myDoctorProfile.licence.file')} error={invalid.file} htmlFor="rl-file" hint={t('myDoctorProfile.licence.fileHint')}>
        <input id="rl-file" type="file" accept={ACCEPTED_FILES} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-primary-soft file:px-3 file:py-2 file:text-xs file:font-semibold file:text-primary" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('doctorApp.fields.licenceNumber')} error={invalid.number} htmlFor="rl-number">
          <Input id="rl-number" value={number} onChange={(e) => setNumber(e.target.value)} maxLength={60} inputClassName={invalid.number ? INVALID : undefined} />
        </Field>
        <Field label={t('doctorApp.fields.licenceCountry')} error={invalid.country} htmlFor="rl-country">
          <Input id="rl-country" value={country} onChange={(e) => setCountry(e.target.value)} maxLength={100} inputClassName={invalid.country ? INVALID : undefined} />
        </Field>
      </div>
      <label className="flex items-start gap-2.5 text-sm text-ink">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[rgb(var(--primary))]" data-licence-ack />
        <span>{t('myDoctorProfile.licence.ack')}</span>
      </label>
      {invalid.ack && <p className="text-2xs font-medium text-danger">{t(invalid.ack)}</p>}
    </ConfirmDialog>
  );
}

function ProfessionalTab({ profile, onSaved }) {
  const { t, lang } = useI18n();
  const notify = useToast();
  const [form, setForm] = useState(doctorForm(profile));
  const [invalid, setInvalid] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(doctorForm(profile)), [profile]);

  const set = (name, value) => {
    setForm((f) => ({ ...f, [name]: value }));
    if (invalid[name]) setInvalid((s) => ({ ...s, [name]: null }));
  };
  const toggleLanguage = (code) => set('languages', form.languages.includes(code) ? form.languages.filter((l) => l !== code) : [...form.languages, code]);

  async function save(e) {
    e.preventDefault();
    const { errors, payload } = validateDoctorForm(form, profile);
    if (!payload) {
      setInvalid(errors);
      notify(t(Object.values(errors)[0]), 'error');
      return;
    }
    if (!Object.keys(payload).length) return notify(t('profile.noChanges'), 'info');
    setSaving(true);
    try {
      onSaved(await updateDoctorProfile(payload));
      setInvalid({});
      notify(t(payload.consultationFee !== undefined ? 'myDoctorProfile.savedFee' : 'profile.saved'), 'success');
    } catch (error) {
      setInvalid(apiFieldErrors(error));
      notify(t(profileErrorKey(error)), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="space-y-6" data-doctor-profile>
      <Card className="p-5 sm:p-6">
        <CardHeader title={t('myDoctorProfile.professional.title')} subtitle={t('myDoctorProfile.professional.subtitle')} />
        <div className="mb-5 rounded-xl border border-line bg-subtle/50 px-4">
          <ReadOnlyRow label={t('doctorApp.fields.professionalName')} value={profile.professionalName} badge={<Lock className="h-3.5 w-3.5 text-muted" aria-label={t('myDoctorProfile.locked')} />} />
          <ReadOnlyRow label={t('doctorApp.fields.specialty')} value={specialtyName(profile.specialty, lang)} badge={<Lock className="h-3.5 w-3.5 text-muted" aria-label={t('myDoctorProfile.locked')} />} />
        </div>
        <p className="-mt-3 mb-5 text-2xs text-muted">{t('myDoctorProfile.lockedHint')}</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t('doctorApp.fields.bio')} error={invalid.bio} htmlFor="dp-bio" hint={t('doctorApp.fields.bioHint', { count: form.bio.trim().length })} className="md:col-span-2">
            <Textarea id="dp-bio" rows={5} maxLength={2000} value={form.bio} onChange={(e) => set('bio', e.target.value)} className={invalid.bio ? INVALID : undefined} />
          </Field>
          <Field label={t('myDoctorProfile.fields.qualifications')} error={invalid.qualifications} htmlFor="dp-qualifications" hint={t('myDoctorProfile.fields.qualificationsHint')} className="md:col-span-2">
            <Textarea id="dp-qualifications" rows={3} maxLength={1000} value={form.qualifications} onChange={(e) => set('qualifications', e.target.value)} />
          </Field>
          <Field label={t('doctorApp.fields.yearsExperience')} error={invalid.yearsExperience} htmlFor="dp-years">
            <Input id="dp-years" type="number" min={0} max={60} value={form.yearsExperience} onChange={(e) => set('yearsExperience', e.target.value)} inputClassName={invalid.yearsExperience ? INVALID : undefined} />
          </Field>
          <Field label={t('doctorApp.fields.consultationFee')} error={invalid.consultationFee} htmlFor="dp-fee" hint={t('myDoctorProfile.fields.feeHint')}>
            <Input id="dp-fee" type="number" min={5} max={200} step="0.01" icon={DollarSign} value={form.consultationFee} onChange={(e) => set('consultationFee', e.target.value)} inputClassName={invalid.consultationFee ? INVALID : undefined} />
          </Field>
          <Field label={t('doctorApp.fields.languages')} error={invalid.languages} className="md:col-span-2">
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('doctorApp.fields.languages')}>
              {LANGUAGES.map((code) => (
                <button
                  key={code}
                  type="button"
                  aria-pressed={form.languages.includes(code)}
                  onClick={() => toggleLanguage(code)}
                  className={cn('rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors', form.languages.includes(code) ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface text-ink hover:bg-subtle')}
                >
                  {t(`languageNames.${code}`)}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <div className="mt-5 flex justify-end">
          <Button type="submit" disabled={saving} data-save-doctor-profile>
            {saving ? t('auth.pleaseWait') : t('profile.save')}
          </Button>
        </div>
      </Card>
    </form>
  );
}

function VerificationTab({ profile, onReplaced }) {
  const { t, locale } = useI18n();
  const [replacing, setReplacing] = useState(false);
  const v = profile.verification;
  return (
    <div className="space-y-6">
      <Card className="p-5 sm:p-6" data-verification>
        <CardHeader title={t('myDoctorProfile.verification.title')} subtitle={t('myDoctorProfile.verification.subtitle')} />
        <div className="rounded-xl border border-line px-4">
          <ReadOnlyRow label={t('myDoctorProfile.verification.status')} value={<ApplicationStatusBadge status={v.status} />} />
          <ReadOnlyRow label={t('myDoctorProfile.verification.verifiedAt')} value={v.verifiedAt ? dateOnly(v.verifiedAt, locale) : '—'} />
          <ReadOnlyRow
            label={t('myDoctorProfile.verification.application')}
            value={v.latestRequest ? `${t(`myDoctorProfile.requestStatus.${v.latestRequest.status}`)} · ${dateOnly(v.latestRequest.submittedAt, locale)}` : '—'}
          />
          <ReadOnlyRow label={t('myDoctorProfile.verification.reverification')} value={v.reverificationPending ? <Badge tone="gold">{t('myDoctorProfile.verification.reverificationPending')}</Badge> : t('myDoctorProfile.verification.none')} />
        </div>
        <p className="mt-3 flex items-start gap-2 text-2xs text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t('myDoctorProfile.verification.adminOnly')}
        </p>
      </Card>

      <Card className="p-5 sm:p-6">
        <CardHeader title={t('myDoctorProfile.licence.title')} subtitle={t('myDoctorProfile.licence.subtitle')} />
        <div className="rounded-xl border border-line px-4">
          <ReadOnlyRow label={t('doctorApp.fields.licenceNumber')} value={profile.licenceNumber} />
          <ReadOnlyRow label={t('doctorApp.fields.licenceCountry')} value={profile.licenceCountry} />
          <ReadOnlyRow
            label={t('myDoctorProfile.licence.document')}
            value={
              profile.licenceDocument ? (
                <span className="flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-muted" /> {t('myDoctorProfile.licence.version', { n: profile.licenceDocument.versionNumber, date: dateOnly(profile.licenceDocument.uploadedAt, locale) })}
                </span>
              ) : (
                '—'
              )
            }
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setReplacing(true)} disabled={v.status !== 'VERIFIED'} data-replace-licence>
            <RefreshCw className="h-4 w-4" /> {t('myDoctorProfile.licence.replace')}
          </Button>
        </div>
      </Card>
      {replacing && <ReplaceLicenceDialog profile={profile} onCancel={() => setReplacing(false)} onDone={onReplaced} />}
    </div>
  );
}

function AvailabilityTab() {
  const { t } = useI18n();
  const [data, setData] = useState(undefined);
  useEffect(() => {
    let live = true;
    getMyAvailability()
      .then((d) => live && setData(d))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, []);
  const byDay = (data?.rules ?? []).reduce((m, r) => m.set(r.dayOfWeek, [...(m.get(r.dayOfWeek) ?? []), `${r.startTime}–${r.endTime}`]), new Map());
  return (
    <Card className="p-5 sm:p-6" data-availability-summary>
      <CardHeader
        title={t('myDoctorProfile.availability.title')}
        subtitle={t('myDoctorProfile.availability.subtitle')}
        action={
          <Button size="sm" to="/doctor/availability">
            <CalendarClock className="h-4 w-4" /> {t('myDoctorProfile.availability.manage')}
          </Button>
        }
      />
      {data === undefined && <div className="h-24 animate-pulse rounded-xl bg-subtle" />}
      {data === null && <p className="text-sm text-muted">{t('availability.loadError')}</p>}
      {data && (
        <>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            <Badge tone={data.canManage ? 'green' : 'neutral'}>{data.canManage ? t('myDoctorProfile.availability.canPublish') : t('myDoctorProfile.availability.cannotPublish')}</Badge>
            <Badge tone="neutral">{t('myDoctorProfile.availability.zone', { zone: data.timeZone })}</Badge>
            <Badge tone="neutral">{t('myDoctorProfile.availability.duration', { minutes: data.slotDurationMinutes })}</Badge>
          </div>
          {byDay.size ? (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {[1, 2, 3, 4, 5, 6, 0].filter((d) => byDay.has(d)).map((d) => (
                <li key={d} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="font-semibold text-ink">{t(`availability.dayLong.${d}`)}</span>
                  <span className="text-muted">{byDay.get(d).join(', ')}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{t('myDoctorProfile.availability.none')}</p>
          )}
          <p className="mt-3 text-2xs text-muted">{t('myDoctorProfile.availability.note')}</p>
        </>
      )}
    </Card>
  );
}

/** /doctor/profile — the verified doctor's own professional profile, verification and availability. */
export default function DoctorProfessionalProfilePage() {
  const { t } = useI18n();
  const notify = useToast();
  const auth = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState(undefined);
  const [tab, setTab] = useState('professional');
  const leaving = useRef(false);

  const load = useCallback(() => {
    setProfile(undefined);
    getDoctorProfile()
      .then(setProfile)
      .catch((error) => {
        if (leaving.current) return;
        setProfile(null);
        notify(t(profileErrorKey(error)), 'error');
      });
  }, [notify, t]);
  useEffect(load, [load]);

  async function replaced(result) {
    leaving.current = true;
    notify(t(result.reverificationRequired ? 'myDoctorProfile.licence.submitted' : 'profile.saved'), 'success');
    // The DOCTOR role was removed (Option A): continue in the patient area on the application page.
    navigate('/patient/doctor-application', { replace: true });
    await auth.reload().catch(() => {});
  }

  const header = <PageHeader title={t('myDoctorProfile.title')} subtitle={t('myDoctorProfile.subtitle')} />;
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

  return (
    <>
      {header}
      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: 'professional', label: t('myDoctorProfile.tabs.professional') },
              { value: 'verification', label: t('myDoctorProfile.tabs.verification') },
              { value: 'availability', label: t('myDoctorProfile.tabs.availability') },
            ]}
          />
          {tab === 'professional' && <ProfessionalTab profile={profile} onSaved={setProfile} />}
          {tab === 'verification' && <VerificationTab profile={profile} onReplaced={replaced} />}
          {tab === 'availability' && <AvailabilityTab />}
        </div>
        <aside className="min-w-0 space-y-6">
          <ProfilePhotoCard name={profile.professionalName} publicNote={t('profile.photo.publicNote')} />
          <CompletenessCard completeness={profile.completeness} scope="doctor" />
          <Card className="p-5">
            <CardHeader title={t('myDoctorProfile.public.title')} subtitle={t(profile.listedPublicly ? 'myDoctorProfile.public.listed' : 'myDoctorProfile.public.notListed')} />
            <div className="flex flex-wrap items-center gap-2">
              {profile.listedPublicly ? (
                <Badge tone="green" icon={BadgeCheck}>
                  {t('myDoctorProfile.public.visible')}
                </Badge>
              ) : (
                <Badge tone="neutral">{t('myDoctorProfile.public.hidden')}</Badge>
              )}
            </div>
            {profile.publicProfilePath && (
              <Button variant="secondary" size="sm" className="mt-4 w-full" to={profile.publicProfilePath} target="_blank" rel="noopener">
                <ExternalLink className="h-4 w-4" /> {t('myDoctorProfile.public.view')}
              </Button>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
