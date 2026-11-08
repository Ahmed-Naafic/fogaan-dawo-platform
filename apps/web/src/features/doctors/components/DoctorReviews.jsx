import { useEffect, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Stars } from '@/features/appointments/components/RatingCard';
import { getDoctorReviews } from '../services/doctorDirectoryApi';

/** Public reviews of a listed doctor: average, count and the newest comments (first name + initial only). */
export default function DoctorReviews({ doctorId }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState(undefined);
  useEffect(() => {
    let live = true;
    getDoctorReviews(doctorId)
      .then((d) => live && setData(d))
      .catch(() => live && setData(null));
    return () => {
      live = false;
    };
  }, [doctorId]);

  if (data === undefined) return <div className="mt-6 h-16 animate-pulse rounded-xl bg-subtle" aria-busy="true" />;
  if (!data) return null;
  return (
    <section className="mt-6" data-doctor-reviews>
      <h3 className="mb-2 text-sm font-bold">{t('reviews.title')}</h3>
      {data.count === 0 ? (
        <p className="text-sm text-muted">{t('reviews.none')}</p>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2">
            <Stars value={Math.round(data.average)} size="h-4 w-4" label={t('reviews.average', { avg: data.average, count: data.count })} />
            <span className="text-xs text-muted">{t('reviews.average', { avg: data.average, count: data.count })}</span>
          </div>
          <ul className="space-y-3">
            {data.items.map((r) => (
              <li key={r.id} className="rounded-xl border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <Stars value={r.rating} size="h-3.5 w-3.5" />
                  <span className="text-2xs text-muted">
                    {r.author} · {new Date(r.createdAt).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>
                {r.comment && <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted">{r.comment}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
