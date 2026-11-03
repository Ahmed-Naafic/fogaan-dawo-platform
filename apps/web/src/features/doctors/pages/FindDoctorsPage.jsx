import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Search, SearchX } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import Button from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { getDoctors, getSpecialties } from '@/services';
import { DoctorCard, DoctorRow } from '../components/DoctorCard';
import BookingSheet from '@/features/appointments/components/BookingSheet';

const SORTERS = {
  rating: (a, b) => b.rating - a.rating || b.reviews - a.reviews,
  priceLow: (a, b) => a.fee - b.fee,
  reviews: (a, b) => b.reviews - a.reviews,
};

export default function FindDoctorsPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const specialty = params.get('specialty') ?? 'all';
  const sort = params.get('sort') ?? 'rating';
  const [favorites, setFavorites] = useState(() => new Set(['dr-hodan-axmed']));
  const [booking, setBooking] = useState(null);

  const specialties = getSpecialties();
  const setParam = (key, value, fallback) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!value || value === fallback) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    return getDoctors()
      .filter((d) => specialty === 'all' || d.specialty === specialty)
      .filter((d) => {
        if (!term) return true;
        const hay = [d.name, t(`specialty.${d.specialty}`), t(`specialist.${d.specialty}`), ...d.tags.map((tag) => t(`tags.${tag}`)), d.location].join(' ').toLowerCase();
        return hay.includes(term);
      })
      .sort(SORTERS[sort]);
  }, [q, specialty, sort, t]);

  const toggleFavorite = (id) =>
    setFavorites((f) => {
      const n = new Set(f);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const chips = [{ key: 'all' }, ...specialties.filter((s) => s.primary)];

  return (
    <>
      <PageHeader title={t('doctors.title')} mobileTitle={t('nav.findDoctors')} subtitle={t('doctors.subtitle')} back="/patient" />

      <div className="flex flex-col gap-3 lg:flex-row">
        <Input
          icon={Search}
          value={q}
          onChange={(e) => setParam('q', e.target.value)}
          placeholder={t('patient.searchPlaceholder')}
          aria-label={t('common.search')}
          className="flex-1"
        />
        <Select value={specialty} onChange={(e) => setParam('specialty', e.target.value, 'all')} className="hidden lg:block lg:w-52" aria-label={t('doctors.specialty')}>
          <option value="all">{t('doctors.allSpecialties')}</option>
          {specialties.map((s) => (
            <option key={s.key} value={s.key}>
              {t(`specialty.${s.key}`)}
            </option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setParam('sort', e.target.value, 'rating')} className="lg:w-52" aria-label={t('doctors.sortBy')}>
          <option value="rating">{t('doctors.sort.rating')}</option>
          <option value="priceLow">{t('doctors.sort.priceLow')}</option>
          <option value="reviews">{t('doctors.sort.reviews')}</option>
        </Select>
      </div>

      {/* Mobile specialty chips */}
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none lg:hidden">
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={() => setParam('specialty', c.key, 'all')}
            className={cn(
              'shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors',
              specialty === c.key ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface text-ink',
            )}
          >
            {c.key === 'all' ? t('common.all') : t(`specialty.${c.key}`)}
          </button>
        ))}
      </div>

      <p className="mb-4 mt-5 text-xs font-medium text-muted" aria-live="polite">
        {t('doctors.resultCount', { count: results.length })}
      </p>

      {results.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-subtle text-muted">
            <SearchX className="h-7 w-7" />
          </span>
          <p className="mt-4 font-bold">{t('doctors.emptyTitle')}</p>
          <p className="mt-1 text-sm text-muted">{t('doctors.emptyBody')}</p>
          <Button variant="outline" className="mt-5" onClick={() => setParams({}, { replace: true })}>
            {t('doctors.clearFilters')}
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-3 lg:hidden">
            {results.map((d) => (
              <DoctorRow key={d.id} doctor={d} favorite={favorites.has(d.id)} onToggleFavorite={() => toggleFavorite(d.id)} onBook={setBooking} />
            ))}
          </div>
          <div className="hidden gap-5 lg:grid lg:grid-cols-2 xl:grid-cols-3">
            {results.map((d) => (
              <DoctorCard key={d.id} doctor={d} favorite={favorites.has(d.id)} onToggleFavorite={() => toggleFavorite(d.id)} onBook={setBooking} />
            ))}
          </div>
        </>
      )}

      {booking && <BookingSheet doctor={booking} onClose={() => setBooking(null)} />}
    </>
  );
}
