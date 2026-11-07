/**
 * Timezone arithmetic on IANA zones using only Intl (no server-local time is ever used).
 * Scheduling rule: wall-clock times belong to a named zone; every stored instant is UTC.
 */

const MINUTE = 60_000;
const DAY = 86_400_000;

const formatters = new Map();
function partsFormatter(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

let zoneSet;
/** True for a real IANA zone name (e.g. "Africa/Mogadishu"), or "UTC". */
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length > 64) return false;
  zoneSet ??= new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);
  return zoneSet.has(timeZone);
}

/** Wall-clock parts of an instant in a zone: { year, month, day, hour, minute, second }. */
export function zonedParts(date, timeZone) {
  const out = {};
  for (const p of partsFormatter(timeZone).formatToParts(date)) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return out;
}

/** Offset of the zone from UTC at an instant, in minutes (e.g. +180 for Africa/Mogadishu). */
export function offsetMinutes(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / MINUTE);
}

/** "YYYY-MM-DD" ⇄ { year, month, day } (civil dates, no zone). */
export const parseDate = (s) => {
  const [year, month, day] = s.split('-').map(Number);
  return { year, month, day };
};
export const formatDate = ({ year, month, day }) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** Adds days to a civil date string (calendar arithmetic, unaffected by DST). */
export function addDays(dateString, days) {
  const { year, month, day } = parseDate(dateString);
  const d = new Date(Date.UTC(year, month - 1, day) + days * DAY);
  return formatDate({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
}

/** Day of week of a civil date: 0 = Sunday … 6 = Saturday. */
export function weekdayOf(dateString) {
  const { year, month, day } = parseDate(dateString);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The civil date ("YYYY-MM-DD") of an instant in a zone. */
export function dateInZone(date, timeZone) {
  return formatDate(zonedParts(date, timeZone));
}

/**
 * Converts a wall-clock time in a zone to the UTC instant.
 * - Non-existent times (spring-forward gap) return null; callers skip them.
 * - Ambiguous times (fall-back overlap) resolve to the EARLIER instant.
 */
export function zonedTimeToUtc(dateString, minutesOfDay, timeZone) {
  const { year, month, day } = parseDate(dateString);
  const guess = Date.UTC(year, month - 1, day, 0, 0) + minutesOfDay * MINUTE;
  const target = zonedParts(new Date(guess), 'UTC');
  const offsets = new Set([-DAY, 0, DAY].map((delta) => offsetMinutes(new Date(guess + delta), timeZone)));
  const valid = [];
  for (const off of offsets) {
    const t = guess - off * MINUTE;
    const p = zonedParts(new Date(t), timeZone);
    if (p.year === target.year && p.month === target.month && p.day === target.day && p.hour === target.hour && p.minute === target.minute) valid.push(t);
  }
  return valid.length ? new Date(Math.min(...valid)) : null;
}

/** Start of a civil day in a zone as a UTC instant (if midnight is skipped by DST, the first valid minute). */
export function startOfDayUtc(dateString, timeZone) {
  for (let m = 0; m < 24 * 60; m += 15) {
    const t = zonedTimeToUtc(dateString, m, timeZone);
    if (t) return t;
  }
  throw new Error(`No valid time on ${dateString} in ${timeZone}`);
}

/** "HH:MM" ⇄ minutes after midnight. */
export const timeToMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
export const minutesToTime = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
