import { useEffect, useState } from 'react';
import DoctorReviews from '../components/DoctorReviews';
import { useParams } from 'react-router';
import { ArrowLeft, BadgeCheck, Briefcase, Globe, CalendarCheck, GraduationCap, Languages, ShieldCheck, Video } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Rating from '@/components/shared/Rating';
import SlotPicker from '@/features/appointments/components/SlotPicker';
import { useReserveSlot } from '@/features/appointments/useReserveSlot';
import { apiUrl } from '@/lib/apiClient';
import { useI18n } from '@/lib/i18n';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import DirectoryHeader, { usePublicView } from '../components/DirectoryHeader';
import { formatFee, specialtyLabel } from '../doctorDirectory';
import { getDoctor } from '../services/doctorDirectoryApi';

function Fact({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-subtle p-3.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="text-2xs font-medium text-muted">{label}</p>
        <p className="mt-0.5 text-sm font-bold text-ink">{children}</p>
      </div>
    </div>
  );
}

/** Public doctor profile: professional information and real open consultation times. No private data. */
export default function DoctorProfilePage() {
  const { doctorId } = useParams();
  const { t, lang, locale } = useI18n();
  const { reserve, busy } = useReserveSlot(doctorId);
  const publicView = usePublicView();
  const back = publicView ? '/doctors' : '/patient/doctors';
  const [doctor, setDoctor] = useState(null);
  const [missing, setMissing] = useState(false);
  const [slot, setSlot] = useState(null);

  useEffect(() => {
    let live = true;
    setDoctor(null);
    setMissing(false);
    getDoctor(doctorId)
      .then((d) => live && setDoctor(d))
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [doctorId]);

  if (missing) {
    return (
      <>
        <DirectoryHeader title={t('doctorProfile.notFoundTitle')} back={back} />
        <Card className="flex flex-col items-center px-6 py-14 text-center">
          <p className="text-sm text-muted">{t('doctorProfile.notFoundBody')}</p>
          <Button to={back} variant="outline" className="mt-5">
            <ArrowLeft className="h-4 w-4" /> {t('doctorProfile.backToDoctors')}
          </Button>
        </Card>
      </>
    );
  }

  if (!doctor) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 pt-6 lg:grid-cols-[minmax(0,1fr)_24rem]" aria-busy="true">
        <div className="card h-96 animate-pulse" />
        <div className="card h-96 animate-pulse" />
      </div>
    );
  }

  return (
    <>
      <DirectoryHeader title={doctor.name} mobileTitle={t('doctorProfile.title')} subtitle={specialtyLabel(doctor.specialty, lang)} back={back} />

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="p-5 sm:p-6">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <Avatar src={doctor.photoUrl ? apiUrl(doctor.photoUrl) : null} name={doctor.name} size="xl" className="ring-4 ring-primary-soft" />
            <div className="min-w-0 flex-1">
              <h2 className="flex items-center gap-1.5 text-lg font-extrabold">
                {doctor.name}
                <BadgeCheck className="h-5 w-5 shrink-0 fill-primary text-surface" aria-hidden="true" />
              </h2>
              <p className="text-sm text-muted">{specialtyLabel(doctor.specialty, lang)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone="green" icon={ShieldCheck}>
                  {t('doctorProfile.verified')}
                </Badge>
                {doctor.reviewCount > 0 ? <Rating value={doctor.rating} reviews={doctor.reviewCount} /> : <span className="text-xs font-semibold text-primary">{t('doctors.newDoctor')}</span>}
              </div>
            </div>
            <div className="sm:text-right">
              <p className="text-2xl font-extrabold">{formatFee(doctor.consultationFee, doctor.currency)}</p>
              <p className="text-2xs text-muted">{t('doctors.perConsultation')}</p>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <Fact icon={Languages} label={t('doctorProfile.languages')}>
              {doctor.languages.map((l) => t(`languageNames.${l}`)).join(', ')}
            </Fact>
            <Fact icon={Globe} label={t('doctorProfile.basedIn')}>
              {[doctor.country, doctor.timeZone].filter(Boolean).join(' · ') || '—'}
            </Fact>
            <Fact icon={Briefcase} label={t('doctorProfile.experience')}>
              {doctor.yearsExperience != null ? t('doctorProfile.years', { count: doctor.yearsExperience }) : '—'}
            </Fact>
            <Fact icon={Video} label={t('doctorProfile.consultation')}>
              {doctor.slotDurationMinutes ? t('doctorProfile.videoMinutes', { n: doctor.slotDurationMinutes }) : t('doctorProfile.video')}
            </Fact>
            <Fact icon={CalendarCheck} label={t('doctorProfile.nextAvailable')}>
              {doctor.nextAvailableAt ? formatDateTime(doctor.nextAvailableAt, browserTimeZone(), locale) : t('doctors.noAvailability')}
            </Fact>
          </div>

          <h3 className="mb-2 mt-6 text-sm font-bold">{t('doctorProfile.about')}</h3>
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted">{doctor.bio || '—'}</p>
          {doctor.qualifications && (
            <>
              <h3 className="mb-2 mt-6 flex items-center gap-2 text-sm font-bold">
                <GraduationCap className="h-4 w-4 text-primary" /> {t('doctorProfile.qualifications')}
              </h3>
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted" data-qualifications>
                {doctor.qualifications}
              </p>
            </>
          )}
          <DoctorReviews doctorId={doctor.id} />
          <p className="mt-6 flex items-start gap-2 rounded-xl border border-dashed border-primary/40 bg-primary-soft/40 p-3.5 text-xs text-primary">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> {t('doctorProfile.verifiedNote')}
          </p>
        </Card>

        <Card className="p-5 sm:p-6 lg:sticky lg:top-6">
          <h2 className="mb-4 text-base font-bold">{t('doctorProfile.availability')}</h2>
          <SlotPicker doctor={doctor} value={slot} onChange={setSlot} />
          <Button className="mt-5 w-full" size="lg" disabled={!slot || busy} onClick={() => reserve(slot)}>
            {slot ? t('booking.confirm', { time: formatDateTime(slot.startAtUtc, browserTimeZone(), locale) }) : t('booking.chooseSlot')}
          </Button>
        </Card>
      </div>
    </>
  );
}
