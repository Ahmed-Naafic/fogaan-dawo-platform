import { addDays, dateInZone, isValidTimeZone, startOfDayUtc } from '../../utils/timezone.js';

/**
 * Report date ranges. Every range is half-open [from, to) in UTC instants, built from CALENDAR days in
 * the administrator's time zone (`tz`), so "Today" or "This month" mean the same thing on every card,
 * table and export. Presets: today, 7d (today and the 6 days before), 30d, month (from the 1st),
 * custom (fromDate..toDate inclusive, YYYY-MM-DD), all (no bounds).
 */
export const PRESETS = Object.freeze(['today', '7d', '30d', 'month', 'custom', 'all']);
export const MAX_RANGE_DAYS = 366;
const DEFAULT_TZ = 'Africa/Mogadishu';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Resolves { preset, fromDate, toDate, tz } → { preset, tz, from, to, fromDate, toDate } (from/to: Date or null). */
export function resolveRange({ preset = '30d', fromDate, toDate, tz } = {}, now = new Date()) {
  const zone = tz && isValidTimeZone(tz) ? tz : DEFAULT_TZ;
  if (!PRESETS.includes(preset)) throw Object.assign(new RangeError('Unknown date preset'), { code: 'RANGE_INVALID' });
  const today = dateInZone(now, zone);
  let first;
  let last;
  switch (preset) {
    case 'all':
      return { preset, tz: zone, from: null, to: null, fromDate: null, toDate: null };
    case 'today':
      [first, last] = [today, today];
      break;
    case '7d':
      [first, last] = [addDays(today, -6), today];
      break;
    case '30d':
      [first, last] = [addDays(today, -29), today];
      break;
    case 'month':
      [first, last] = [`${today.slice(0, 8)}01`, today];
      break;
    default: {
      if (!DATE.test(fromDate ?? '') || !DATE.test(toDate ?? '')) throw Object.assign(new RangeError('Custom ranges need fromDate and toDate (YYYY-MM-DD)'), { code: 'RANGE_INVALID' });
      if (Number.isNaN(Date.parse(`${fromDate}T00:00:00Z`)) || Number.isNaN(Date.parse(`${toDate}T00:00:00Z`))) throw Object.assign(new RangeError('Invalid date'), { code: 'RANGE_INVALID' });
      if (fromDate > toDate) throw Object.assign(new RangeError('fromDate must not be after toDate'), { code: 'RANGE_INVALID' });
      const days = (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000 + 1;
      if (days > MAX_RANGE_DAYS) throw Object.assign(new RangeError(`A custom range can cover at most ${MAX_RANGE_DAYS} days`), { code: 'RANGE_TOO_LONG' });
      [first, last] = [fromDate, toDate];
    }
  }
  return { preset, tz: zone, from: startOfDayUtc(first, zone), to: startOfDayUtc(addDays(last, 1), zone), fromDate: first, toDate: last };
}

/** Prisma `where` fragment for a date column within the range ({} for "all"). */
export const inRange = (range) => (range.from ? { gte: range.from, lt: range.to } : undefined);

/** Calendar day / month (in the range's zone) of an instant, for trend buckets. */
export const dayKey = (date, tz) => dateInZone(date, tz);
/** YYYY-MM of an instant in the given time zone (monthly report buckets). */
export const monthKey = (date, tz) => dateInZone(date, tz).slice(0, 7);

/** Public description of the range (ISO strings), returned with every report. */
export const describeRange = (r) => ({ preset: r.preset, tz: r.tz, from: r.from?.toISOString() ?? null, to: r.to?.toISOString() ?? null, fromDate: r.fromDate, toDate: r.toDate });
