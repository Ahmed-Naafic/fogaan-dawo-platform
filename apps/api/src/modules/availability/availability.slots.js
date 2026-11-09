import { addDays, dateInZone, weekdayOf, zonedTimeToUtc } from '../../utils/timezone.js';
import { SLOT_HORIZON_DAYS } from './availability.constants.js';

/**
 * Pure slot planning (unit-tested; no database).
 *
 * rules:  [{ id, dayOfWeek, startMinutes, endMinutes, slotDurationMinutes, timeZone, effectiveFrom, effectiveUntil }]
 *         times are wall-clock minutes in the rule's zone; effective dates are "YYYY-MM-DD" (until is inclusive) or null.
 * blocks: [{ startAt: Date, endAt: Date }] (UTC instants)
 * Returns non-overlapping candidates [{ sourceRuleId, startAtUtc, endAtUtc, timeZone }], sorted, all in the future.
 */
export function planSlots({ rules, blocks = [], now = new Date(), horizonDays = SLOT_HORIZON_DAYS }) {
  const out = [];
  for (const rule of rules) {
    const today = dateInZone(now, rule.timeZone);
    for (let i = 0; i < horizonDays; i += 1) {
      const date = addDays(today, i);
      if (weekdayOf(date) !== rule.dayOfWeek) continue;
      if (rule.effectiveFrom && date < rule.effectiveFrom) continue;
      if (rule.effectiveUntil && date > rule.effectiveUntil) continue;
      for (let m = rule.startMinutes; m + rule.slotDurationMinutes <= rule.endMinutes; m += rule.slotDurationMinutes) {
        const start = zonedTimeToUtc(date, m, rule.timeZone);
        if (!start) continue; // wall time skipped by a daylight-saving change
        // The end must also be the wall time m + duration (not just +N minutes) — otherwise a DST jump
        // inside the slot would make it longer/shorter than the consultation. Skip such slots.
        const end = new Date(start.getTime() + rule.slotDurationMinutes * 60_000);
        const wallEnd = zonedTimeToUtc(date, m + rule.slotDurationMinutes, rule.timeZone);
        if (m + rule.slotDurationMinutes < 24 * 60 && (!wallEnd || wallEnd.getTime() !== end.getTime())) continue;
        if (start <= now) continue;
        if (blocks.some((b) => overlaps(start, end, b.startAt, b.endAt))) continue;
        out.push({ sourceRuleId: rule.id, startAtUtc: start, endAtUtc: end, timeZone: rule.timeZone });
      }
    }
  }
  out.sort((a, b) => a.startAtUtc - b.startAtUtc || a.endAtUtc - b.endAtUtc);
  // Defensive: never emit overlapping candidates (rules are validated not to overlap, but be safe).
  const result = [];
  for (const slot of out) {
    const last = result[result.length - 1];
    if (!last || slot.startAtUtc >= last.endAtUtc) result.push(slot);
  }
  return result;
}

/** True when two [start, end) intervals overlap. */
export const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

const key = (s) => `${s.startAtUtc.getTime()}|${s.endAtUtc.getTime()}|${s.sourceRuleId ?? ''}`;

/**
 * Reconciles planned slots with what is already stored.
 * existing: slots that have not ended [{ id, startAtUtc, endAtUtc, sourceRuleId, status, appointmentCount }]
 * Only future AVAILABLE slots without any appointment are replaceable; everything else (held, booked,
 * blocked, slots with appointment history) is fixed and wins over new candidates.
 * Returns { create: [...], remove: [ids] } — applying it is idempotent (no duplicates).
 */
export function reconcileSlots({ planned, existing, busy = [], now = new Date() }) {
  const replaceable = existing.filter((s) => s.status === 'AVAILABLE' && s.appointmentCount === 0 && s.startAtUtc > now);
  const fixed = [...existing.filter((s) => !replaceable.includes(s)), ...busy];
  const wanted = planned.filter((p) => !fixed.some((f) => overlaps(p.startAtUtc, p.endAtUtc, f.startAtUtc, f.endAtUtc)));
  const wantedKeys = new Set(wanted.map(key));
  const keptKeys = new Set();
  const remove = [];
  for (const s of replaceable) {
    if (wantedKeys.has(key(s)) && !keptKeys.has(key(s))) keptKeys.add(key(s));
    else remove.push(s.id);
  }
  return { create: wanted.filter((p) => !keptKeys.has(key(p))), remove };
}
