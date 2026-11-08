import { useState } from 'react';
import { Star } from 'lucide-react';
import Button from '@/components/ui/Button';
import Card, { CardHeader } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { rateAppointment } from '../services/appointmentApi';

/** Read-only or clickable 1–5 stars. */
export function Stars({ value, onChange, size = 'h-6 w-6', label }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1" role={onChange ? 'radiogroup' : 'img'} aria-label={label ?? t('reviews.starsLabel', { n: value ?? 0 })}>
      {[1, 2, 3, 4, 5].map((n) => {
        const icon = <Star className={cn(size, n <= (value ?? 0) ? 'fill-amber-400 text-amber-400' : 'text-line')} />;
        return onChange ? (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={t('reviews.starsLabel', { n })} onClick={() => onChange(n)} className="rounded p-0.5 hover:scale-110">
            {icon}
          </button>
        ) : (
          <span key={n}>{icon}</span>
        );
      })}
    </div>
  );
}

/**
 * Requirement 13: after a completed consultation the patient rates it once (1–5 stars, optional comment).
 * `action` is the server's `actions.rate`; `review` the submitted rating (shown read-only).
 */
export default function RatingCard({ appointmentId, action, review, onDone }) {
  const { t } = useI18n();
  const notify = useToast();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  if (review) {
    return (
      <Card className="p-5 sm:p-6" data-review>
        <CardHeader title={t('reviews.yourRating')} />
        <Stars value={review.rating} />
        {review.comment && <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{review.comment}</p>}
      </Card>
    );
  }
  if (!action?.allowed) return null;

  const submit = async () => {
    if (!rating) return notify(t('reviews.pickStars'), 'error');
    setBusy(true);
    try {
      await rateAppointment(appointmentId, { rating, ...(comment.trim() ? { comment: comment.trim() } : {}) });
      notify(t('reviews.thanks'), 'success');
      onDone?.();
    } catch (error) {
      notify(t(error?.code === 'REVIEW_ALREADY_SUBMITTED' ? 'reviews.already' : 'reviews.failed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 sm:p-6" data-rate>
      <CardHeader title={t('reviews.rateTitle')} subtitle={t('reviews.rateSubtitle')} />
      <Stars value={rating} onChange={setRating} size="h-8 w-8" />
      <Textarea className="mt-4" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('reviews.commentPlaceholder')} aria-label={t('reviews.commentPlaceholder')} />
      <div className="mt-3 flex justify-end">
        <Button onClick={submit} disabled={busy}>
          {t('reviews.submit')}
        </Button>
      </div>
    </Card>
  );
}
