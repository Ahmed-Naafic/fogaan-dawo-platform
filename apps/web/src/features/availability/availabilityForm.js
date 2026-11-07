/**
 * Pure logic for the doctor availability screens (unit-tested). Mirrors the API's Zod rules for instant,
 * translated feedback; the API stays the authority.
 */
import { addCivilDays, todayIn, wallTime } from '../../lib/timezone.js'; // relative: also loaded by Node unit tests

/** Monday-first display order; values are JS/API weekdays (0 = Sunday). */
export const DAY_ORDER = Object.freeze([1, 2, 3, 4, 5, 6, 0]);
export const SLOT_DURATIONS = Object.freeze([20, 30]);
export const MAX_PERIODS_PER_DAY = 4;
const DEFAULT_PERIOD = Object.freeze({ startTime: '09:00', endTime: '17:00' });

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};
const validTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v ?? '');

/** API availability → editable form { timeZone, slotDurationMinutes, days: { [dow]: { enabled, periods } } }. */
export function scheduleFromAvailability(data) {
  const days = {};
  for (const dow of DAY_ORDER) {
    const periods = (data?.rules ?? [])
      .filter((r) => r.dayOfWeek === dow)
      .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))
      .map((r) => ({ startTime: r.startTime, endTime: r.endTime }));
    days[dow] = periods.length ? { enabled: true, periods } : { enabled: false, periods: [{ ...DEFAULT_PERIOD }] };
  }
  return { timeZone: data?.timeZone ?? 'Africa/Mogadishu', slotDurationMinutes: data?.slotDurationMinutes ?? 30, days };
}

/** Form → PUT /schedule body (disabled days are sent with no periods). */
export const toScheduleBody = (form) => ({
  timeZone: form.timeZone,
  slotDurationMinutes: Number(form.slotDurationMinutes),
  days: DAY_ORDER.map((dow) => ({ dayOfWeek: dow, periods: form.days[dow].enabled ? form.days[dow].periods.map((p) => ({ startTime: p.startTime, endTime: p.endTime })) : [] })),
});

export const isScheduleDirty = (form, saved) => JSON.stringify(toScheduleBody(form)) !== JSON.stringify(toScheduleBody(saved));

/** Returns { "<dow>.<index>": translationKey } for every invalid period of an enabled day. */
export function validateSchedule(form) {
  const errors = {};
  const duration = Number(form.slotDurationMinutes);
  for (const dow of DAY_ORDER) {
    const day = form.days[dow];
    if (!day.enabled) continue;
    const ordered = day.periods.map((p, i) => ({ ...p, i })).sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
    ordered.forEach((p, k) => {
      const key = `${dow}.${p.i}`;
      if (!validTime(p.startTime) || !validTime(p.endTime)) errors[key] = 'availability.errors.time';
      else if (toMinutes(p.endTime) <= toMinutes(p.startTime)) errors[key] = 'availability.errors.endBeforeStart';
      else if (toMinutes(p.endTime) - toMinutes(p.startTime) < duration) errors[key] = 'availability.errors.tooShort';
      else if (k > 0 && toMinutes(p.startTime) < toMinutes(ordered[k - 1].endTime)) errors[key] = 'availability.errors.overlap';
    });
  }
  return errors;
}

/** How many consultations fit in a period. */
export const slotsInPeriod = (p, duration) => (validTime(p.startTime) && validTime(p.endTime) ? Math.max(0, Math.floor((toMinutes(p.endTime) - toMinutes(p.startTime)) / Number(duration))) : 0);

/** Weekly consultation capacity of the form. */
export const weeklyCapacity = (form) => DAY_ORDER.reduce((n, dow) => n + (form.days[dow].enabled ? form.days[dow].periods.reduce((m, p) => m + slotsInPeriod(p, form.slotDurationMinutes), 0) : 0), 0);

/** Next free period after the last one (for "Add break / period"), or null if the day is full. */
export function nextPeriod(periods) {
  const last = [...periods].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime)).at(-1);
  if (!last) return { ...DEFAULT_PERIOD };
  const start = toMinutes(last.endTime) + 60;
  if (start + 60 > 23 * 60 + 59) return null;
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return { startTime: fmt(start), endTime: fmt(Math.min(start + 180, 23 * 60 + 59)) };
}

/** Block form → POST /blocks body. */
export function toBlockBody(form, timeZone) {
  const reason = form.reason?.trim() || undefined;
  return form.kind === 'DAYS'
    ? { kind: 'DAYS', timeZone, startDate: form.startDate, endDate: form.endDate || form.startDate, ...(reason ? { reason } : {}) }
    : { kind: 'PERIOD', timeZone, date: form.date, startTime: form.startTime, endTime: form.endTime, ...(reason ? { reason } : {}) };
}

/** Client checks for the block form: { field: translationKey }. */
export function validateBlock(form, timeZone, now = new Date()) {
  const errors = {};
  const today = todayIn(timeZone, now);
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '');
  if (form.kind === 'DAYS') {
    if (!isDate(form.startDate)) errors.startDate = 'availability.errors.date';
    else if (form.startDate < today) errors.startDate = 'availability.errors.past';
    if (form.endDate && isDate(form.startDate) && form.endDate < form.startDate) errors.endDate = 'availability.errors.endDateBefore';
  } else {
    if (!isDate(form.date)) errors.date = 'availability.errors.date';
    else if (form.date < today) errors.date = 'availability.errors.past';
    if (!validTime(form.startTime) || !validTime(form.endTime)) errors.endTime = 'availability.errors.time';
    else if (toMinutes(form.endTime) <= toMinutes(form.startTime)) errors.endTime = 'availability.errors.endBeforeStart';
  }
  return errors;
}

/** A stored block (UTC) described in the schedule's zone: whole days, or one time period. */
export function describeBlock(block, timeZone) {
  const startDate = todayIn(timeZone, new Date(block.startAt));
  const endDate = todayIn(timeZone, new Date(block.endAt));
  const startWall = wallTime(block.startAt, timeZone);
  const endWall = wallTime(block.endAt, timeZone);
  if (startWall === '00:00' && endWall === '00:00') return { kind: 'DAYS', startDate, endDate: addCivilDays(endDate, -1) };
  return { kind: 'PERIOD', date: startDate, endDate, startTime: startWall, endTime: endWall };
}

const ERROR_CODES = new Set(['DOCTOR_NOT_BOOKABLE', 'BLOCK_OVERLAP', 'BLOCK_IN_PAST', 'RULE_NOT_FOUND', 'BLOCK_NOT_FOUND', 'VALIDATION_ERROR', 'RATE_LIMITED', 'NETWORK_ERROR']);
export const availabilityErrorKey = (error) => `availability.apiErrors.${ERROR_CODES.has(error?.code) ? error.code : 'GENERIC'}`;
