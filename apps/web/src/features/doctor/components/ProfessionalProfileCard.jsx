import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import Card, { CardHeader } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { ApplicationStatusBadge, CompletionBar, DocumentRow } from '@/features/doctors/components/ApplicationParts';
import { doctorErrorKey, specialtyName } from '@/features/doctors/doctorApplicationForm';
import * as api from '@/features/doctors/services/doctorApplicationApi';
import { useI18n } from '@/lib/i18n';

function Item({ label, children }) {
  return (
    <div className="rounded-xl bg-subtle/70 px-3.5 py-3">
      <dt className="text-2xs font-semibold text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-bold text-ink">{children}</dd>
    </div>
  );
}

/** The verified doctor's real profile (GET /api/v1/doctors/me), in the dashboard's existing card style. */
export default function ProfessionalProfileCard() {
  const { t, lang } = useI18n();
  const notify = useToast();
  const [profile, setProfile] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    api
      .getMyDoctorProfile()
      .then((p) => !cancelled && setProfile(p))
      .catch((error) => !cancelled && (setProfile(null), notify(t(doctorErrorKey(error)), 'error')));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
  }, []);

  if (profile === undefined) return <Card className="h-44 animate-pulse" aria-busy="true" />;
  if (profile === null) return null;

  return (
    <Card className="p-5 sm:p-6" aria-labelledby="professional-profile-title">
      <CardHeader
        title={<span id="professional-profile-title">{t('doctorDash.profileTitle')}</span>}
        action={
          <Link to="/patient/doctor-application" className="text-xs font-semibold text-primary hover:underline">
            {t('doctorDash.viewApplication')}
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <dl className="grid grid-cols-2 gap-2.5">
            <Item label={t('doctorDash.status')}>
              <ApplicationStatusBadge status={profile.status} />
            </Item>
            <Item label={t('doctorApp.fields.specialty')}>{specialtyName(profile.specialty, lang)}</Item>
            <Item label={t('doctorApp.fields.consultationFee')}>{t('doctorDash.feeValue', { fee: profile.consultationFee })}</Item>
            <Item label={t('doctorApp.fields.languages')}>{profile.languages.map((l) => t(`languageNames.${l}`)).join(', ')}</Item>
          </dl>
          <div className="mt-5">
            <CompletionBar completion={profile.completion} />
          </div>
        </div>
        <div>
          <p className="mb-3 text-sm font-bold">{t('doctorApp.sections.documents')}</p>
          <ul className="space-y-3">
            {profile.documents.map((doc) => (
              <li key={doc.id}>
                <DocumentRow document={doc} download={api.downloadMyDocument} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
