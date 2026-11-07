import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AlertTriangle, BadgeCheck, Clock3, DollarSign, Hourglass, Send, ShieldCheck, Stethoscope, Upload } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import IconTile from '@/components/ui/IconTile';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/features/auth/AuthProvider';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { ApplicationStatusBadge, CompletionBar, DocumentRow, VerificationHistory } from '../components/ApplicationParts';
import {
  ACCEPTED_FILES,
  checkFile,
  doctorErrorKey,
  DOCUMENT_TYPES,
  emptyApplication,
  fieldsForApiError,
  formFromApplication,
  isDirty,
  LANGUAGES,
  specialtyName,
  validateApplication,
} from '../doctorApplicationForm';
import * as api from '../services/doctorApplicationApi';

const INVALID = 'border-danger/70 focus:border-danger focus:ring-danger/10';
const STATUS_ICON = { NOT_SUBMITTED: [Stethoscope, 'teal'], PENDING: [Hourglass, 'gold'], UNDER_REVIEW: [Clock3, 'blue'], VERIFIED: [BadgeCheck, 'green'], REJECTED: [AlertTriangle, 'rose'] };

function Field({ label, error, children, hint, className }) {
  const { t } = useI18n();
  return (
    <div className={className}>
      <span className="mb-1.5 block text-xs font-semibold text-ink">{label}</span>
      {children}
      {error ? <p className="mt-1.5 text-2xs font-medium text-danger">{t(error)}</p> : hint ? <p className="mt-1.5 text-2xs text-muted">{hint}</p> : null}
    </div>
  );
}

function StatusCard({ application, onOpenDashboard, opening }) {
  const { t } = useI18n();
  const status = application?.status ?? 'NOT_SUBMITTED';
  const [Icon, tone] = STATUS_ICON[status];
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <IconTile icon={Icon} tone={tone} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold sm:text-[17px]">{t(`doctorApp.statusTitle.${status}`)}</h2>
            <ApplicationStatusBadge status={status} />
          </div>
          <p className="mt-1 text-sm text-muted">{t(`doctorApp.statusBody.${status}`)}</p>
          {status === 'REJECTED' && application.rejectionReason && (
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200" role="note">
              <p className="text-2xs font-bold uppercase tracking-wider">{t('doctorApp.rejectionReason')}</p>
              <p className="mt-1 whitespace-pre-line">{application.rejectionReason}</p>
            </div>
          )}
          {status === 'VERIFIED' && (
            <Button className="mt-4" onClick={onOpenDashboard} disabled={opening}>
              <ShieldCheck className="h-4 w-4" /> {t('doctorApp.openDashboard')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function DoctorApplicationPage() {
  const { t, lang } = useI18n();
  const notify = useToast();
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [specialties, setSpecialties] = useState([]);
  const [application, setApplication] = useState(undefined); // undefined = loading, null = none yet
  const [form, setForm] = useState(emptyApplication);
  const [invalid, setInvalid] = useState({});
  const [busy, setBusy] = useState(null); // 'save' | 'submit' | 'upload:<TYPE>' | 'dashboard'
  const fileInputs = useRef({});

  const apply = useCallback((app) => {
    setApplication(app);
    setForm(formFromApplication(app));
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listSpecialties(), api.getMyApplication()])
      .then(([list, app]) => {
        if (cancelled) return;
        setSpecialties(list);
        apply(app);
        if (!app && auth.session?.user?.fullName) setForm((f) => ({ ...f, professionalName: auth.session.user.fullName }));
      })
      .catch((error) => !cancelled && (setApplication(null), notify(t(doctorErrorKey(error)), 'error')));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
  }, []);

  const editable = application === null || Boolean(application?.editable);
  const setField = (name, value) => {
    setForm((f) => ({ ...f, [name]: value }));
    if (invalid[name]) setInvalid((s) => ({ ...s, [name]: null }));
  };
  const toggleLanguage = (code) => setField('languages', form.languages.includes(code) ? form.languages.filter((l) => l !== code) : [...form.languages, code]);

  async function save({ quiet = false } = {}) {
    const { errors, payload } = validateApplication(form);
    if (!payload) {
      setInvalid(errors);
      notify(t(Object.values(errors)[0]), 'error');
      return null;
    }
    setBusy('save');
    try {
      const saved = await api.saveMyApplication(payload);
      apply(saved);
      setInvalid({});
      if (!quiet) notify(t('doctorApp.saved'), 'success');
      return saved;
    } catch (error) {
      setInvalid(Object.fromEntries(fieldsForApiError(error).map((f) => [f, 'doctorErrors.VALIDATION_ERROR'])));
      notify(t(doctorErrorKey(error)), 'error');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function upload(type, file) {
    const problem = checkFile(file);
    if (problem) return notify(t(problem), 'error');
    setBusy(`upload:${type}`);
    try {
      await api.uploadDocument(type, file);
      apply(await api.getMyApplication());
      notify(t('doctorApp.uploadedOk'), 'success');
    } catch (error) {
      notify(t(doctorErrorKey(error)), 'error');
    } finally {
      setBusy(null);
      if (fileInputs.current[type]) fileInputs.current[type].value = '';
    }
  }

  async function submit() {
    let current = application;
    if (!current || isDirty(form, current)) current = await save({ quiet: true });
    if (!current) return;
    if (!current.completion.readyToSubmit) return notify(t('doctorErrors.APPLICATION_INCOMPLETE'), 'error');
    setBusy('submit');
    try {
      apply(await api.submitMyApplication());
      notify(t('doctorApp.submitted'), 'success');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      notify(t(doctorErrorKey(error)), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function openDashboard() {
    setBusy('dashboard');
    try {
      await auth.reload(); // picks up the DOCTOR role granted on approval
      navigate('/doctor');
    } catch (error) {
      notify(t(doctorErrorKey(error)), 'error');
      setBusy(null);
    }
  }

  const fieldProps = (name) => ({
    value: form[name],
    onChange: (e) => setField(name, e.target.value),
    disabled: !editable,
    'aria-invalid': invalid[name] ? true : undefined,
  });

  if (application === undefined) {
    return (
      <>
        <PageHeader title={t('doctorApp.title')} subtitle={t('doctorApp.subtitle')} />
        <Card className="h-40 animate-pulse p-6" aria-busy="true" />
      </>
    );
  }

  const status = application?.status ?? 'NOT_SUBMITTED';
  const currentDoc = (type) => application?.documents.find((d) => d.documentType === type);
  const previousCount = (type) => (application?.documentHistory ?? []).filter((d) => d.documentType === type && !d.isCurrent).length;

  return (
    <>
      <PageHeader title={t('doctorApp.title')} subtitle={t('doctorApp.subtitle')} />
      {params.get('welcome') === '1' && !application && (
        <p className="mb-4 rounded-xl border border-primary/30 bg-primary-soft/60 px-4 py-3 text-sm text-ink" role="status">
          {t('doctorApp.welcome')}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <StatusCard application={application} onOpenDashboard={openDashboard} opening={busy === 'dashboard'} />

          {/* Professional details */}
          <Card className="p-5 sm:p-6">
            <CardHeader title={t('doctorApp.sections.details')} subtitle={status === 'PENDING' || status === 'UNDER_REVIEW' ? t('doctorApp.locked') : null} />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t('doctorApp.fields.professionalName')} error={invalid.professionalName} className="md:col-span-2">
                <Input name="professionalName" autoComplete="name" inputClassName={invalid.professionalName ? INVALID : undefined} {...fieldProps('professionalName')} />
              </Field>
              <Field label={t('doctorApp.fields.specialty')} error={invalid.specialtyId}>
                <Select name="specialtyId" className={invalid.specialtyId ? '[&_select]:border-danger/70' : undefined} {...fieldProps('specialtyId')}>
                  <option value="">{t('doctorApp.fields.chooseSpecialty')}</option>
                  {specialties.map((s) => (
                    <option key={s.id} value={s.id}>
                      {specialtyName(s, lang)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('doctorApp.fields.consultationFee')} error={invalid.consultationFee}>
                <Input name="consultationFee" type="number" inputMode="decimal" min="5" max="200" step="0.01" icon={DollarSign} inputClassName={invalid.consultationFee ? INVALID : undefined} {...fieldProps('consultationFee')} />
              </Field>
              <Field label={t('doctorApp.fields.licenceNumber')} error={invalid.licenceNumber}>
                <Input name="licenceNumber" autoComplete="off" inputClassName={invalid.licenceNumber ? INVALID : undefined} {...fieldProps('licenceNumber')} />
              </Field>
              <Field label={t('doctorApp.fields.licenceCountry')} error={invalid.licenceCountry}>
                <Input name="licenceCountry" autoComplete="country-name" inputClassName={invalid.licenceCountry ? INVALID : undefined} {...fieldProps('licenceCountry')} />
              </Field>
              <Field label={t('doctorApp.fields.yearsExperience')} error={invalid.yearsExperience}>
                <Input name="yearsExperience" type="number" inputMode="numeric" min="0" max="60" step="1" inputClassName={invalid.yearsExperience ? INVALID : undefined} {...fieldProps('yearsExperience')} />
              </Field>
              <Field label={t('doctorApp.fields.bio')} error={invalid.bio} hint={t('doctorApp.fields.bioHint', { count: form.bio.trim().length })} className="md:col-span-2">
                <Textarea name="bio" rows={5} maxLength={2000} className={invalid.bio ? INVALID : undefined} {...fieldProps('bio')} />
              </Field>
              <Field label={t('doctorApp.fields.languages')} error={invalid.languages} className="md:col-span-2">
                <div className="flex flex-wrap gap-2" role="group" aria-label={t('doctorApp.fields.languages')}>
                  {LANGUAGES.map((code) => (
                    <button
                      key={code}
                      type="button"
                      disabled={!editable}
                      aria-pressed={form.languages.includes(code)}
                      onClick={() => toggleLanguage(code)}
                      className={cn(
                        'rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60',
                        form.languages.includes(code) ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface text-ink hover:bg-subtle',
                      )}
                    >
                      {t(`languageNames.${code}`)}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
            {editable && (
              <div className="mt-5 flex justify-end">
                <Button variant="secondary" onClick={() => save()} disabled={busy !== null}>
                  {busy === 'save' ? t('auth.pleaseWait') : t('doctorApp.save')}
                </Button>
              </div>
            )}
          </Card>

          {/* Documents */}
          <Card className="p-5 sm:p-6">
            <CardHeader title={t('doctorApp.sections.documents')} subtitle={t('doctorApp.documentsHint')} />
            {!application && <p className="mb-4 text-xs font-medium text-muted">{t('doctorApp.saveFirst')}</p>}
            <ul className="divide-y divide-line">
              {DOCUMENT_TYPES.map(({ type, required }) => {
                const doc = currentDoc(type);
                const uploading = busy === `upload:${type}`;
                const uploadButton = editable && application && (
                  <>
                    <input
                      ref={(el) => (fileInputs.current[type] = el)}
                      type="file"
                      accept={ACCEPTED_FILES}
                      className="sr-only"
                      id={`upload-${type}`}
                      data-document-type={type}
                      onChange={(e) => e.target.files?.[0] && upload(type, e.target.files[0])}
                    />
                    <Button variant={doc ? 'secondary' : 'outline'} size="sm" disabled={busy !== null} onClick={() => fileInputs.current[type]?.click()}>
                      <Upload className="h-3.5 w-3.5" /> {uploading ? t('doctorApp.uploading') : doc ? t('doctorApp.replace') : t('doctorApp.upload')}
                    </Button>
                  </>
                );
                return (
                  <li key={type} className="py-4 first:pt-0 last:pb-0">
                    <p className="mb-2.5 flex items-center gap-2 text-sm font-bold">
                      {t(`docType.${type}`)}
                      <span className={cn('text-2xs font-semibold', required ? 'text-danger' : 'text-muted')}>{required ? t('doctorApp.required') : t('doctorApp.optional')}</span>
                    </p>
                    {doc ? (
                      <DocumentRow document={doc} download={api.downloadMyDocument} action={uploadButton} />
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-muted">{t('doctorApp.notUploaded')}</span>
                        {uploadButton}
                      </div>
                    )}
                    {previousCount(type) > 0 && <p className="mt-2 text-2xs text-muted">{t('doctorApp.previousVersions', { count: previousCount(type) })}</p>}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          {status !== 'VERIFIED' && (
          <Card className="p-5 sm:p-6">
            <CardHeader title={t('doctorApp.sections.submit')} />
            <CompletionBar completion={application?.completion ?? { percent: 0, missing: [], readyToSubmit: false }} showMissing={Boolean(application)} />
            {editable && (
              <Button className="mt-5 w-full" onClick={submit} disabled={busy !== null || !application?.completion.readyToSubmit}>
                <Send className="h-4 w-4" /> {busy === 'submit' ? t('auth.pleaseWait') : status === 'REJECTED' ? t('doctorApp.resubmit') : t('doctorApp.submit')}
              </Button>
            )}
            {editable && application && !application.completion.readyToSubmit && <p className="mt-2.5 text-2xs text-muted">{t('doctorApp.notReady')}</p>}
          </Card>
          )}

          {application?.history?.length > 0 && (
            <Card className="p-5 sm:p-6">
              <CardHeader title={t('doctorApp.sections.history')} />
              <VerificationHistory history={application.history} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
