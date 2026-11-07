import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight, Search, SearchX } from 'lucide-react';
import Button from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import BookingSheet from '@/features/appointments/components/BookingSheet';
import { listSpecialties } from '../services/doctorApplicationApi';
import { searchDoctors } from '../services/doctorDirectoryApi';
import { DoctorCard, DoctorRow } from '../components/DoctorCard';
import DirectoryHeader, { usePublicView } from '../components/DirectoryHeader';
import { directoryQuery, FEE_RANGES, resolveSpecialty, SORTS, specialtyLabel } from '../doctorDirectory';
import { LANGUAGES } from '../doctorApplicationForm';

/** Doctor directory: verified, active doctors from the API — search, filter, sort (public or in the patient shell). */
export default function FindDoctorsPage() {
  const { t, lang } = useI18n();
  const publicView = usePublicView();
  const base = publicView ? '/doctors' : '/patient/doctors';
  const [params, setParams] = useSearchParams();
  const [specialties, setSpecialties] = useState(null);
  const [term, setTerm] = useState(params.get('q') ?? '');
  const [result, setResult] = useState(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [favorites, setFavorites] = useState(() => new Set());
  const [booking, setBooking] = useState(null);

  const setParam = (key, value, fallback) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (!value || value === fallback) next.delete(key);
        else next.set(key, value);
        if (key !== 'page') next.delete('page');
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    listSpecialties()
      .then(setSpecialties)
      .catch(() => setSpecialties([]));
  }, []);

  // Debounced search term → URL.
  useEffect(() => {
    const id = setTimeout(() => {
      if ((params.get('q') ?? '') !== term.trim()) setParam('q', term.trim());
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const queryKey = specialties ? JSON.stringify(directoryQuery(params, specialties)) : null;
  useEffect(() => {
    if (!queryKey) return undefined;
    let live = true;
    setFailed(false);
    setResult(null);
    searchDoctors(JSON.parse(queryKey))
      .then((r) => live && setResult(r))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [queryKey, reloadKey]);

  const specialtyId = specialties ? resolveSpecialty(params.get('specialty'), specialties) : '';
  const fee = FEE_RANGES[params.get('fee')] ? params.get('fee') : 'any';
  const sort = SORTS.includes(params.get('sort')) ? params.get('sort') : 'rating';
  const language = LANGUAGES.includes(params.get('language')) ? params.get('language') : '';
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  const toggleFavorite = (id) =>
    setFavorites((f) => {
      const n = new Set(f);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const filters = (
    <>
      <Select value={language} onChange={(e) => setParam('language', e.target.value)} aria-label={t('doctors.language')} name="language">
        <option value="">{t('doctors.allLanguages')}</option>
        {LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {t(`languageNames.${l}`)}
          </option>
        ))}
      </Select>
      <Select value={fee} onChange={(e) => setParam('fee', e.target.value, 'any')} aria-label={t('doctors.fee')} name="fee">
        {Object.keys(FEE_RANGES).map((k) => (
          <option key={k} value={k}>
            {t(`doctors.feeRange.${k}`)}
          </option>
        ))}
      </Select>
      <Select value={sort} onChange={(e) => setParam('sort', e.target.value, 'rating')} aria-label={t('doctors.sortBy')} name="sort">
        {SORTS.map((s) => (
          <option key={s} value={s}>
            {t(`doctors.sort.${s}`)}
          </option>
        ))}
      </Select>
    </>
  );

  return (
    <>
      <DirectoryHeader title={t('doctors.title')} mobileTitle={t('nav.findDoctors')} subtitle={t('doctors.subtitle')} back="/patient" />

      <div className="flex flex-col gap-3 lg:flex-row">
        <Input icon={Search} value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('doctors.searchPlaceholder')} aria-label={t('common.search')} className="flex-1" name="q" />
        <Select value={specialtyId || 'all'} onChange={(e) => setParam('specialty', e.target.value, 'all')} className="hidden lg:block lg:w-48" aria-label={t('doctors.specialty')} name="specialty">
          <option value="all">{t('doctors.allSpecialties')}</option>
          {(specialties ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {specialtyLabel(s, lang)}
            </option>
          ))}
        </Select>
        <div className="hidden gap-3 lg:flex [&>*]:w-44">{filters}</div>
      </div>

      {/* Mobile: specialty chips + compact filters */}
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none lg:hidden">
        {[{ id: 'all' }, ...(specialties ?? [])].map((s) => {
          const active = s.id === 'all' ? !specialtyId : specialtyId === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setParam('specialty', s.id, 'all')}
              className={cn('shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors', active ? 'border-primary bg-primary text-primary-fg' : 'border-line bg-surface text-ink')}
            >
              {s.id === 'all' ? t('common.all') : specialtyLabel(s, lang)}
            </button>
          );
        })}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 lg:hidden [&>*:last-child]:col-span-2 [&_select]:h-10">{filters}</div>

      <p className="mb-4 mt-5 text-xs font-medium text-muted" aria-live="polite">
        {result ? t('doctors.resultCount', { count: result.total }) : ' '}
      </p>

      {failed ? (
        <div className="card flex flex-col items-center px-6 py-14 text-center">
          <p className="font-bold">{t('doctors.loadError')}</p>
          <Button variant="outline" className="mt-5" onClick={() => setReloadKey((k) => k + 1)}>
            {t('doctors.retry')}
          </Button>
        </div>
      ) : !result ? (
        <div className="grid gap-3 lg:grid-cols-2 lg:gap-5 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="card h-28 animate-pulse lg:h-80" />
          ))}
        </div>
      ) : result.items.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-subtle text-muted">
            <SearchX className="h-7 w-7" />
          </span>
          <p className="mt-4 font-bold">{t('doctors.emptyTitle')}</p>
          <p className="mt-1 text-sm text-muted">{t('doctors.emptyBody')}</p>
          <Button
            variant="outline"
            className="mt-5"
            onClick={() => {
              setTerm('');
              setParams({}, { replace: true });
            }}
          >
            {t('doctors.clearFilters')}
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-3 lg:hidden">
            {result.items.map((d) => (
              <DoctorRow key={d.id} doctor={d} profileHref={`${base}/${d.id}`} favorite={favorites.has(d.id)} onToggleFavorite={() => toggleFavorite(d.id)} />
            ))}
          </div>
          <div className="hidden gap-5 lg:grid lg:grid-cols-2 xl:grid-cols-3">
            {result.items.map((d) => (
              <DoctorCard key={d.id} doctor={d} profileHref={`${base}/${d.id}`} favorite={favorites.has(d.id)} onToggleFavorite={() => toggleFavorite(d.id)} onBook={setBooking} />
            ))}
          </div>
          {pages > 1 && (
            <nav className="mt-6 flex items-center justify-center gap-3" aria-label={t('doctors.pagination')}>
              <Button variant="secondary" size="sm" disabled={result.page <= 1} onClick={() => setParam('page', String(result.page - 1), '1')}>
                <ChevronLeft className="h-4 w-4" /> {t('doctors.prevPage')}
              </Button>
              <span className="text-xs font-semibold text-muted">{t('doctors.pageOf', { page: result.page, pages })}</span>
              <Button variant="secondary" size="sm" disabled={result.page >= pages} onClick={() => setParam('page', String(result.page + 1), '1')}>
                {t('doctors.nextPage')} <ChevronRight className="h-4 w-4" />
              </Button>
            </nav>
          )}
        </>
      )}

      {booking && <BookingSheet doctor={booking} onClose={() => setBooking(null)} />}
    </>
  );
}
