import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { LANGUAGES, specialtyName } from '@/features/doctors/doctorApplicationForm';
import { listSpecialties } from '@/features/doctors/services/doctorApplicationApi';

const field = 'mb-3 block';
const label = 'mb-1 block text-xs font-semibold text-muted';

/**
 * Requirement 1 ("Admin can edit"): correct a doctor's profile — name, specialty, country, time zone,
 * experience, fee ($5–$200, new bookings only), bio (50–2000) and languages. Only changed fields are
 * sent; the server validates everything again and audits the change.
 */
export default function DoctorEditDialog({ doctor, busy, onSave, onCancel }) {
  const { t, lang } = useI18n();
  const [specialties, setSpecialties] = useState([]);
  const [form, setForm] = useState({
    fullName: doctor.name ?? '',
    specialtyId: doctor.specialty?.id ?? '',
    country: doctor.country ?? '',
    timeZone: doctor.timeZone ?? '',
    yearsExperience: doctor.yearsExperience ?? '',
    consultationFee: doctor.consultationFee ?? '',
    bio: doctor.bio ?? '',
    languages: doctor.languages ?? [],
  });
  const [error, setError] = useState(null);
  useEffect(() => {
    listSpecialties()
      .then(setSpecialties)
      .catch(() => setSpecialties([]));
  }, []);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = (e) => {
    e.preventDefault();
    const fee = Number(form.consultationFee);
    if (!Number.isFinite(fee) || fee < 5 || fee > 200) return setError('adminDoctors.edit.errors.fee');
    if (form.bio.trim().length < 50) return setError('adminDoctors.edit.errors.bio');
    if (!form.languages.length) return setError('adminDoctors.edit.errors.languages');
    if (form.fullName.trim().length < 3) return setError('adminDoctors.edit.errors.name');
    setError(null);
    const before = { fullName: doctor.name, specialtyId: doctor.specialty?.id, country: doctor.country ?? '', timeZone: doctor.timeZone ?? '', yearsExperience: doctor.yearsExperience ?? '', consultationFee: doctor.consultationFee, bio: doctor.bio ?? '' };
    const payload = {};
    if (form.fullName.trim() !== before.fullName) payload.fullName = form.fullName.trim();
    if (form.specialtyId && form.specialtyId !== before.specialtyId) payload.specialtyId = form.specialtyId;
    if (form.country.trim() !== before.country) payload.country = form.country.trim() || null;
    if (form.timeZone.trim() && form.timeZone.trim() !== before.timeZone) payload.timeZone = form.timeZone.trim();
    if (String(form.yearsExperience) !== String(before.yearsExperience)) payload.yearsExperience = form.yearsExperience === '' ? null : Number(form.yearsExperience);
    if (fee.toFixed(2) !== before.consultationFee) payload.consultationFee = fee;
    if (form.bio.trim() !== before.bio.trim()) payload.bio = form.bio.trim();
    if ([...form.languages].sort().join() !== [...(doctor.languages ?? [])].sort().join()) payload.languages = form.languages;
    if (!Object.keys(payload).length) return onCancel();
    return onSave(payload);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="doctor-edit-title">
      <button aria-hidden="true" tabIndex={-1} className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !busy && onCancel()} />
      <form onSubmit={submit} noValidate className="relative max-h-[92vh] w-full max-w-lg animate-fade-up overflow-y-auto rounded-t-3xl border border-line bg-surface p-5 shadow-float sm:rounded-3xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id="doctor-edit-title" className="text-lg font-extrabold">
            {t('adminDoctors.edit.title', { name: doctor.name })}
          </h2>
          <button type="button" onClick={onCancel} disabled={busy} className="-mr-2 -mt-1 rounded-lg p-2 text-muted hover:bg-subtle" aria-label={t('common.close')}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <label className={field}>
          <span className={label}>{t('adminDoctors.edit.name')}</span>
          <Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} maxLength={160} />
        </label>
        <label className={field}>
          <span className={label}>{t('adminDoctors.edit.specialty')}</span>
          <Select value={form.specialtyId} onChange={(e) => set('specialtyId', e.target.value)}>
            {specialties.map((s) => (
              <option key={s.id} value={s.id}>
                {specialtyName(s, lang)}
              </option>
            ))}
          </Select>
        </label>
        <div className="grid gap-x-3 sm:grid-cols-2">
          <label className={field}>
            <span className={label}>{t('adminDoctors.edit.country')}</span>
            <Input value={form.country} onChange={(e) => set('country', e.target.value)} maxLength={100} />
          </label>
          <label className={field}>
            <span className={label}>{t('adminDoctors.edit.timeZone')}</span>
            <Input value={form.timeZone} onChange={(e) => set('timeZone', e.target.value)} placeholder="Europe/London" maxLength={64} />
          </label>
          <label className={field}>
            <span className={label}>{t('adminDoctors.edit.years')}</span>
            <Input type="number" min={0} max={60} value={form.yearsExperience} onChange={(e) => set('yearsExperience', e.target.value)} />
          </label>
          <label className={field}>
            <span className={label}>{t('adminDoctors.edit.fee')}</span>
            <Input type="number" min={5} max={200} step="0.01" value={form.consultationFee} onChange={(e) => set('consultationFee', e.target.value)} />
          </label>
        </div>
        <label className={field}>
          <span className={label}>{t('adminDoctors.edit.bio')}</span>
          <Textarea rows={4} maxLength={2000} value={form.bio} onChange={(e) => set('bio', e.target.value)} />
        </label>
        <fieldset className="mb-3">
          <legend className={label}>{t('adminDoctors.edit.languages')}</legend>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((l) => {
              const on = form.languages.includes(l);
              return (
                <button key={l} type="button" aria-pressed={on} onClick={() => set('languages', on ? form.languages.filter((x) => x !== l) : [...form.languages, l])} className={cn('rounded-full border px-3 py-1 text-xs font-semibold', on ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted')}>
                  {t(`languageNames.${l}`)}
                </button>
              );
            })}
          </div>
        </fieldset>
        <p className="mb-3 text-2xs text-muted">{t('adminDoctors.edit.feeNote')}</p>
        {error && (
          <p className="mb-3 text-xs text-danger" role="alert">
            {t(error)}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {t('adminDoctors.edit.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
