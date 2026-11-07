/**
 * Display helpers for UTC instants in an explicit IANA zone. The API stores and returns UTC; the
 * page decides which zone to show (the viewer's, or the doctor's) — never the server's.
 * Civil dates ("YYYY-MM-DD") are formatted at UTC noon so they never shift a day.
 */

export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export const formatTime = (iso, timeZone, locale) => new Date(iso).toLocaleTimeString(locale, { timeZone, hour: 'numeric', minute: '2-digit' });

export const formatDateTime = (iso, timeZone, locale) =>
  new Date(iso).toLocaleString(locale, { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const civil = (dateString) => new Date(`${dateString}T12:00:00Z`);
export const formatCivilDate = (dateString, locale, options = { weekday: 'short', month: 'short', day: 'numeric' }) => civil(dateString).toLocaleDateString(locale, { timeZone: 'UTC', ...options });
export const civilWeekday = (dateString, locale) => civil(dateString).toLocaleDateString(locale, { timeZone: 'UTC', weekday: 'short' });
export const civilDay = (dateString) => civil(dateString).getUTCDate();

/** Today's civil date in a zone. */
export function todayIn(timeZone, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

export function addCivilDays(dateString, days) {
  const d = new Date(civil(dateString).getTime() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Wall-clock "HH:MM" (24h) of an instant in a zone — for comparing against schedule times. */
export const wallTime = (iso, timeZone) => new Date(iso).toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "GMT+3", "GMT-5" … for a zone at an instant (DST-aware). */
export function zoneOffsetLabel(timeZone, at = new Date()) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName');
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/** "Africa/Mogadishu (GMT+3)" */
export const zoneLabel = (timeZone, at) => `${timeZone.replaceAll('_', ' ')} (${zoneOffsetLabel(timeZone, at)})`;

/** Every IANA zone the browser knows (fallback: a short list that covers the main audience). */
export function timeZoneList() {
  try {
    const all = Intl.supportedValuesOf('timeZone');
    return all.includes('UTC') ? all : [...all, 'UTC'];
  } catch {
    return ['Africa/Mogadishu', 'Africa/Nairobi', 'Africa/Addis_Ababa', 'Africa/Djibouti', 'Asia/Dubai', 'Europe/London', 'Europe/Stockholm', 'America/New_York', 'America/Toronto', 'America/Chicago', 'UTC'];
  }
}
