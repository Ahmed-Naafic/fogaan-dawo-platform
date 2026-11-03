import { BadgeCheck, ChevronRight, Heart } from 'lucide-react';
import Avatar from '@/components/ui/Avatar';
import Button from '@/components/ui/Button';
import Rating from '@/components/shared/Rating';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';

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

/** Grid card from the "Find & Book a Doctor" desktop reference. */
export function DoctorCard({ doctor, favorite, onToggleFavorite, onBook }) {
  const { t } = useI18n();
  return (
    <article className="card relative flex flex-col p-5 transition-shadow hover:shadow-float">
      <FavoriteButton active={favorite} onToggle={onToggleFavorite} className="absolute right-3 top-3" />
      <Avatar src={doctor.avatar} name={doctor.name} size="xl" className="mb-4 ring-4 ring-primary-soft" />
      <h3 className="flex items-center gap-1.5 text-[15px] font-bold">
        {doctor.name}
        {doctor.verified && <BadgeCheck className="h-[18px] w-[18px] fill-primary text-surface" aria-label={t('doctors.verified')} />}
      </h3>
      <p className="mt-0.5 text-[13px] text-muted">{t(`specialist.${doctor.specialty}`)}</p>
      <div className="mt-2">
        <Rating value={doctor.rating} reviews={doctor.reviews} />
      </div>
      <p className="mt-2 text-sm text-muted">
        <span className="text-lg font-extrabold text-ink">${doctor.fee}</span> / {t('doctors.perConsultation')}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {doctor.tags.map((tag) => (
          <span key={tag} className="rounded-md bg-subtle px-2 py-1 text-2xs font-medium text-muted">
            {t(`tags.${tag}`)}
          </span>
        ))}
      </div>
      <Button className="mt-5 w-full" onClick={() => onBook?.(doctor)}>
        {t('doctors.bookAppointment')}
      </Button>
    </article>
  );
}

/** List row from the mobile "Find Doctors" reference. */
export function DoctorRow({ doctor, favorite, onToggleFavorite, onBook }) {
  const { t } = useI18n();
  return (
    <article className="card flex items-center gap-3.5 p-3.5">
      <button type="button" onClick={() => onBook?.(doctor)} className="flex min-w-0 flex-1 items-center gap-3.5 text-left">
        <Avatar src={doctor.avatar} name={doctor.name} size="lg" className="ring-2 ring-primary-soft" />
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1 truncate text-sm font-bold">
            {doctor.name}
            {doctor.verified && <BadgeCheck className="h-4 w-4 shrink-0 fill-primary text-surface" />}
          </h3>
          <p className="text-xs text-muted">{t(`specialist.${doctor.specialty}`)}</p>
          <div className="mt-0.5">
            <Rating value={doctor.rating} reviews={doctor.reviews} compact />
          </div>
          <p className="mt-0.5 text-xs text-muted">
            <span className="text-sm font-extrabold text-ink">${doctor.fee}</span> / {t('doctors.perConsultation')}
          </p>
        </div>
      </button>
      <div className="flex flex-col items-end gap-6 self-stretch">
        <FavoriteButton active={favorite} onToggle={onToggleFavorite} className="-mr-1 -mt-1" />
        <ChevronRight className="h-4 w-4 text-muted" />
      </div>
    </article>
  );
}
