// Unit tests: timezone conversion (UTC storage, DST) and slot planning / reconciliation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dateInZone, isValidTimeZone, startOfDayUtc, weekdayOf, zonedTimeToUtc } from '../../apps/api/src/utils/timezone.js';
import { planSlots, reconcileSlots } from '../../apps/api/src/modules/availability/availability.slots.js';
import { blockSchema, scheduleSchema } from '../../apps/api/src/modules/availability/availability.validation.js';

const iso = (d) => d?.toISOString() ?? null;
const at = (s) => new Date(s);

test('wall-clock times convert to UTC per zone, including daylight-saving changes', () => {
  assert.equal(iso(zonedTimeToUtc('2026-11-10', 9 * 60, 'Africa/Mogadishu')), '2026-11-10T06:00:00.000Z', 'UTC+3, no DST');
  assert.equal(iso(zonedTimeToUtc('2026-07-01', 9 * 60, 'Europe/London')), '2026-07-01T08:00:00.000Z', 'BST');
  assert.equal(iso(zonedTimeToUtc('2026-12-01', 9 * 60, 'Europe/London')), '2026-12-01T09:00:00.000Z', 'GMT');
  assert.equal(zonedTimeToUtc('2026-03-08', 2 * 60 + 30, 'America/New_York'), null, 'spring-forward gap does not exist');
  assert.equal(iso(zonedTimeToUtc('2026-11-01', 90, 'America/New_York')), '2026-11-01T05:30:00.000Z', 'fall-back ambiguity resolves to the earlier instant');
  assert.equal(iso(zonedTimeToUtc('2026-07-01', 9 * 60, 'Pacific/Chatham')), '2026-06-30T20:15:00.000Z', 'quarter-hour offset and date change');
});

test('date boundaries are computed in the viewer zone, not the server zone', () => {
  const instant = at('2026-11-10T22:30:00Z');
  assert.equal(dateInZone(instant, 'UTC'), '2026-11-10');
  assert.equal(dateInZone(instant, 'Africa/Mogadishu'), '2026-11-11');
  assert.equal(dateInZone(instant, 'America/Los_Angeles'), '2026-11-10');
  assert.equal(iso(startOfDayUtc('2026-11-11', 'Africa/Mogadishu')), '2026-11-10T21:00:00.000Z');
  assert.equal(iso(startOfDayUtc('2026-03-08', 'America/New_York')), '2026-03-08T05:00:00.000Z');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekdayOf('2026-11-04'), 3);
  assert.ok(isValidTimeZone('Africa/Mogadishu') && isValidTimeZone('UTC') && !isValidTimeZone('Mars/Olympus') && !isValidTimeZone('+03:00'));
});

const rule = (over = {}) => ({ id: 'r1', dayOfWeek: 2, startMinutes: 9 * 60, endMinutes: 11 * 60, slotDurationMinutes: 30, timeZone: 'Africa/Mogadishu', effectiveFrom: '2026-01-01', effectiveUntil: null, ...over });

test('slots are generated in UTC from weekly rules, skip the past and respect the horizon', () => {
  const now = at('2026-11-02T00:00:00Z'); // Monday
  const slots = planSlots({ rules: [rule()], now, horizonDays: 7 });
  assert.deepEqual(slots.map((s) => iso(s.startAtUtc)), ['2026-11-03T06:00:00.000Z', '2026-11-03T06:30:00.000Z', '2026-11-03T07:00:00.000Z', '2026-11-03T07:30:00.000Z']);
  assert.ok(slots.every((s) => s.endAtUtc - s.startAtUtc === 30 * 60_000 && s.timeZone === 'Africa/Mogadishu' && s.sourceRuleId === 'r1'));
  const later = planSlots({ rules: [rule()], now: at('2026-11-03T06:45:00Z'), horizonDays: 7 });
  assert.equal(iso(later[0].startAtUtc), '2026-11-03T07:00:00.000Z', 'past and in-progress slots excluded');
  assert.equal(planSlots({ rules: [rule({ effectiveFrom: '2026-11-04' })], now, horizonDays: 7 }).length, 0, 'effective dates respected');
  assert.equal(planSlots({ rules: [rule({ slotDurationMinutes: 20, endMinutes: 10 * 60 + 10 })], now, horizonDays: 7 }).length, 3, 'a partial last slot is not created');
});

test('blocked dates and periods prevent slot generation', () => {
  const now = at('2026-11-02T00:00:00Z');
  const wholeDay = [{ startAt: startOfDayUtc('2026-11-03', 'Africa/Mogadishu'), endAt: startOfDayUtc('2026-11-04', 'Africa/Mogadishu') }];
  assert.equal(planSlots({ rules: [rule()], blocks: wholeDay, now, horizonDays: 7 }).length, 0);
  const period = [{ startAt: at('2026-11-03T06:30:00Z'), endAt: at('2026-11-03T07:15:00Z') }];
  assert.deepEqual(planSlots({ rules: [rule()], blocks: period, now, horizonDays: 7 }).map((s) => iso(s.startAtUtc)), ['2026-11-03T06:00:00.000Z', '2026-11-03T07:30:00.000Z']);
});

test('daylight-saving days: no slot in the gap, none that spans the change, none duplicated', () => {
  const ny = (day, start, end) => rule({ dayOfWeek: 0, startMinutes: start, endMinutes: end, timeZone: 'America/New_York' });
  const spring = planSlots({ rules: [ny(0, 60, 4 * 60)], now: at('2026-03-07T12:00:00Z'), horizonDays: 2 });
  assert.deepEqual(spring.map((s) => iso(s.startAtUtc)), ['2026-03-08T06:00:00.000Z', '2026-03-08T07:00:00.000Z', '2026-03-08T07:30:00.000Z']);
  const autumn = planSlots({ rules: [ny(0, 0, 3 * 60)], now: at('2026-10-31T12:00:00Z'), horizonDays: 2 });
  const starts = autumn.map((s) => s.startAtUtc.getTime());
  assert.equal(new Set(starts).size, starts.length);
  assert.ok(autumn.every((s, i) => i === 0 || s.startAtUtc >= autumn[i - 1].endAtUtc), 'never overlapping');
});

test('reconciliation is idempotent and never replaces held, booked or appointment-linked slots', () => {
  const now = at('2026-11-02T00:00:00Z');
  const planned = planSlots({ rules: [rule()], now, horizonDays: 7 });
  const first = reconcileSlots({ planned, existing: [], now });
  assert.equal(first.create.length, 4);
  const stored = first.create.map((s, i) => ({ id: `s${i}`, ...s, status: 'AVAILABLE', appointmentCount: 0 }));
  assert.deepEqual(reconcileSlots({ planned, existing: stored, now }), { create: [], remove: [] }, 'second run changes nothing');

  stored[1].status = 'BOOKED';
  const busy = [{ startAtUtc: at('2026-11-03T07:00:00Z'), endAtUtc: at('2026-11-03T07:30:00Z') }];
  const shifted = planSlots({ rules: [rule({ startMinutes: 9 * 60 + 15, endMinutes: 11 * 60 + 15 })], now, horizonDays: 7 });
  const next = reconcileSlots({ planned: shifted, existing: stored, busy, now });
  assert.ok(!next.remove.includes('s1'), 'booked slot kept');
  assert.deepEqual(next.remove.sort(), ['s0', 's2', 's3']);
  assert.ok(next.create.every((c) => !(c.startAtUtc < stored[1].endAtUtc && stored[1].startAtUtc < c.endAtUtc)), 'no overlap with the booked slot');
  assert.ok(next.create.every((c) => !(c.startAtUtc < busy[0].endAtUtc && busy[0].startAtUtc < c.endAtUtc)), 'no overlap with an appointment');
});

test('schedule and block validation rejects invalid hours, overlaps and unknown fields', () => {
  const ok = { timeZone: 'Africa/Mogadishu', slotDurationMinutes: 30, days: [{ dayOfWeek: 1, periods: [{ startTime: '09:00', endTime: '12:00' }, { startTime: '13:00', endTime: '17:00' }] }] };
  assert.ok(scheduleSchema.safeParse(ok).success, 'a break between two periods is valid');
  const bad = (over) => !scheduleSchema.safeParse({ ...ok, ...over }).success;
  assert.ok(bad({ days: [{ dayOfWeek: 1, periods: [{ startTime: '12:00', endTime: '09:00' }] }] }), 'end before start');
  assert.ok(bad({ days: [{ dayOfWeek: 1, periods: [{ startTime: '09:00', endTime: '12:00' }, { startTime: '11:00', endTime: '13:00' }] }] }), 'overlap');
  assert.ok(bad({ days: [{ dayOfWeek: 1, periods: [{ startTime: '09:00', endTime: '09:15' }] }] }), 'shorter than a consultation');
  assert.ok(bad({ days: [{ dayOfWeek: 7, periods: [] }] }), 'day out of range');
  assert.ok(bad({ days: [{ dayOfWeek: 1, periods: [] }, { dayOfWeek: 1, periods: [] }] }), 'duplicate day');
  assert.ok(bad({ slotDurationMinutes: 45 }), 'unsupported duration');
  assert.ok(bad({ timeZone: 'Somewhere/Else' }), 'unknown zone');
  assert.ok(bad({ days: [{ dayOfWeek: 1, periods: [{ startTime: '25:00', endTime: '26:00' }] }] }), 'invalid time');
  assert.ok(bad({ doctorId: '00000000-0000-4000-8000-000000000000' }), 'mass assignment rejected');
  assert.ok(blockSchema.safeParse({ kind: 'DAYS', timeZone: 'UTC', startDate: '2026-12-24', endDate: '2026-12-26' }).success);
  assert.ok(!blockSchema.safeParse({ kind: 'DAYS', timeZone: 'UTC', startDate: '2026-12-26', endDate: '2026-12-24' }).success);
  assert.ok(!blockSchema.safeParse({ kind: 'DAYS', timeZone: 'UTC', startDate: '2026-02-30', endDate: '2026-03-01' }).success, 'impossible date');
  assert.ok(!blockSchema.safeParse({ kind: 'PERIOD', timeZone: 'UTC', date: '2026-12-24', startTime: '14:00', endTime: '13:00' }).success);
});
