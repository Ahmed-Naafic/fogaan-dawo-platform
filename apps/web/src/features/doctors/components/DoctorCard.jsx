import { BadgeCheck, CalendarClock, ChevronRight, Heart } from 'lucide-react';
import { Link } from 'react-router';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Rating from '@/components/shared/Rating';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { browserTimeZone, formatDateTime } from '@/lib/timezone';
import { formatFee, specialtyLabel } from '../doctorDirectory';
import { apiUrl } from '@/lib/apiClient';

function FavoriteButton({ active, onToggle, className }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={active ? t('doctors.removeFavorite') : t('doctors.addFavorite')}
      className={cn('rounded-full p-1.5 transition-colors hover:bg-subtle', active ? 'text-rose-500' : 'text-ink/70', className)}
    >
      <Heart className={cn('h-5 w-5', active && 'fill-current')} strokeWidth={1.9} />
    </button>
  );
}

/** Rating when the doctor has reviews, otherwise a "New" marker (never a made-up score). */
function RatingOrNew({ doctor, compact }) {
  const { t } = useI18n();
  return doctor.reviewCount > 0 ? <Rating value={doctor.rating} reviews={doctor.reviewCount} compact={compact} /> : <span className="text-xs font-semibold text-primary">{t('doctors.newDoctor')}</span>;
}

function NextAvailable({ doctor, className }) {
  const { t, locale } = useI18n();
  return (
    <p className={cn('flex items-center gap-1.5 text-2xs font-medium', doctor.nextAvailableAt ? 'text-primary' : 'text-muted', className)}>
      <CalendarClock className="h-3.5 w-3.5 shrink-0" />
      {doctor.nextAvailableAt ? t('doctors.nextAvailable', { when: formatDateTime(doctor.nextAvailableAt, browserTimeZone(), locale) }) : t('doctors.noAvailability')}
    </p>
  );
}

/** Grid card from the "Find & Book a Doctor" desktop reference. */
export function DoctorCard({ doctor, favorite, onToggleFavorite, onBook, profileHref }) {
  const { t, lang } = useI18n();
  return (
    <article className="card relative flex flex-col p-5 transition-shadow hover:shadow-float">
      <FavoriteButton active={favorite} onToggle={onToggleFavorite} className="absolute right-3 top-3" />
      <Link to={profileHref} className="group">
        <Avatar src={doctor.photoUrl ? apiUrl(doctor.photoUrl) : null} name={doctor.name} size="xl" className="mb-4 ring-4 ring-primary-soft" />
        <h3 className="flex items-center gap-1.5 text-[15px] font-bold group-hover:text-primary">
          {doctor.name}
          <BadgeCheck className="h-[18px] w-[18px] shrink-0 fill-primary text-surface" aria-label={t('doctors.verified')} />
        </h3>
      </Link>
      <p className="mt-0.5 text-[13px] text-muted">{specialtyLabel(doctor.specialty, lang)}</p>
      <div className="mt-2">
        <RatingOrNew doctor={doctor} />
      </div>
      <p className="mt-2 text-sm text-muted">
        <span className="text-lg font-extrabold text-ink">{formatFee(doctor.consultationFee, doctor.currency)}</span> / {t('doctors.perConsultation')}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {doctor.languages.map((l) => (
          <span key={l} className="rounded-md bg-subtle px-2 py-1 text-2xs font-medium text-muted">
            {t(`languageNames.${l}`)}
          </span>
        ))}
      </div>
      <NextAvailable doctor={doctor} className="mt-3" />
      <div className="mt-auto pt-5">
        <Button className="w-full" onClick={() => onBook?.(doctor)} disabled={!doctor.nextAvailableAt}>
          {t('doctors.bookAppointment')}
        </Button>
      </div>
    </article>
  );
}

/** List row from the mobile "Find Doctors" reference. */
export function DoctorRow({ doctor, favorite, onToggleFavorite, profileHref }) {
  const { t, lang } = useI18n();
  return (
    <article className="card flex items-center gap-3.5 p-3.5">
      <Link to={profileHref} className="flex min-w-0 flex-1 items-center gap-3.5 text-left">
        <Avatar src={doctor.photoUrl ? apiUrl(doctor.photoUrl) : null} name={doctor.name} size="lg" className="ring-2 ring-primary-soft" />
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1 truncate text-sm font-bold">
            <span className="truncate">{doctor.name}</span>
            <BadgeCheck className="h-4 w-4 shrink-0 fill-primary text-surface" aria-label={t('doctors.verified')} />
          </h3>
          <p className="text-xs text-muted">{specialtyLabel(doctor.specialty, lang)}</p>
          <div className="mt-0.5">
            <RatingOrNew doctor={doctor} compact />
          </div>
          <p className="mt-0.5 text-xs text-muted">
            <span className="text-sm font-extrabold text-ink">{formatFee(doctor.consultationFee, doctor.currency)}</span> / {t('doctors.perConsultation')}
          </p>
          <NextAvailable doctor={doctor} className="mt-1" />
        </div>
      </Link>
      <div className="flex flex-col items-end gap-6 self-stretch">
        <FavoriteButton active={favorite} onToggle={onToggleFavorite} className="-mr-1 -mt-1" />
        <ChevronRight className="h-4 w-4 text-muted" />
      </div>
    </article>
  );
}
