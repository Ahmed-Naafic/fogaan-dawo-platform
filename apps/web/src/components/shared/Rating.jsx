import { Star } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

export default function Rating({ value, reviews, compact = false }) {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
      <span className="font-bold text-amber-500">{value.toFixed(1)}</span>
      <span className="text-muted">{compact ? `(${reviews})` : `(${reviews} ${t('doctors.reviews')})`}</span>
    </span>
  );
}
