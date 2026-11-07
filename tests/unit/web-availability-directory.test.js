// Unit tests: web availability form logic, directory query building and timezone display helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  availabilityErrorKey,
  describeBlock,
  isScheduleDirty,
  nextPeriod,
  scheduleFromAvailability,
  toBlockBody,
  toScheduleBody,
  validateBlock,
  validateSchedule,
  weeklyCapacity,
} from '../../apps/web/src/features/availability/availabilityForm.js';
import { directoryQuery, formatFee, resolveSpecialty } from '../../apps/web/src/features/doctors/doctorDirectory.js';
import { addCivilDays, formatTime, todayIn, wallTime, zoneOffsetLabel } from '../../apps/web/src/lib/timezone.js';

const saved = {
  timeZone: 'Africa/Mogadishu',
  slotDurationMinutes: 30,
  rules: [
    { id: 'a', dayOfWeek: 1, startTime: '13:00', endTime: '17:00', slotDurationMinutes: 30, timeZone: 'Africa/Mogadishu' },
    { id: 'b', dayOfWeek: 1, startTime: '09:00', endTime: '12:00', slotDurationMinutes: 30, timeZone: 'Africa/Mogadishu' },
  ],
};

test('schedule form round-trips the API shape (Monday-first, breaks kept, days off sent empty)', () => {
  const form = scheduleFromAvailability(saved);
  assert.deepEqual(form.days[1], { enabled: true, periods: [{ startTime: '09:00', endTime: '12:00' }, { startTime: '13:00', endTime: '17:00' }] });
  assert.equal(form.days[0].enabled, false);
  const body = toScheduleBody(form);
  assert.equal(body.days.length, 7);
  assert.deepEqual(body.days[0], { dayOfWeek: 1, periods: [{ startTime: '09:00', endTime: '12:00' }, { startTime: '13:00', endTime: '17:00' }] });
  assert.deepEqual(body.days[6], { dayOfWeek: 0, periods: [] });
  assert.equal(weeklyCapacity(form), 6 + 8);
  assert.equal(isScheduleDirty(form, scheduleFromAvailability(saved)), false);
  assert.equal(isScheduleDirty({ ...form, slotDurationMinutes: 20 }, form), true);
  assert.deepEqual(nextPeriod(form.days[1].periods), { startTime: '18:00', endTime: '21:00' });
  assert.equal(nextPeriod([{ startTime: '20:00', endTime: '23:00' }]), null, 'no room left in the day');
});

test('schedule validation mirrors the API rules', () => {
  const form = scheduleFromAvailability(saved);
  const withMonday = (periods) => ({ ...form, days: { ...form.days, 1: { enabled: true, periods } } });
  assert.deepEqual(validateSchedule(form), {});
  assert.equal(validateSchedule(withMonday([{ startTime: '12:00', endTime: '09:00' }]))['1.0'], 'availability.errors.endBeforeStart');
  assert.equal(validateSchedule(withMonday([{ startTime: '09:00', endTime: '09:20' }]))['1.0'], 'availability.errors.tooShort');
  assert.equal(validateSchedule(withMonday([{ startTime: '09:00', endTime: '12:00' }, { startTime: '11:00', endTime: '13:00' }]))['1.1'], 'availability.errors.overlap');
  assert.equal(validateSchedule(withMonday([{ startTime: '', endTime: '12:00' }]))['1.0'], 'availability.errors.time');
  const off = { ...form, days: { ...form.days, 1: { enabled: false, periods: [{ startTime: '12:00', endTime: '09:00' }] } } };
  assert.deepEqual(validateSchedule(off), {}, 'disabled days are not validated');
});

test('blocks: client checks, request body and description in the schedule zone', () => {
  const now = new Date('2026-11-04T08:00:00Z');
  const tz = 'Africa/Mogadishu';
  assert.deepEqual(validateBlock({ kind: 'DAYS', startDate: '2026-11-03' }, tz, now), { startDate: 'availability.errors.past' });
  assert.deepEqual(validateBlock({ kind: 'DAYS', startDate: '2026-11-10', endDate: '2026-11-09' }, tz, now), { endDate: 'availability.errors.endDateBefore' });
  assert.deepEqual(validateBlock({ kind: 'PERIOD', date: '2026-11-10', startTime: '14:00', endTime: '13:00' }, tz, now), { endTime: 'availability.errors.endBeforeStart' });
  assert.deepEqual(toBlockBody({ kind: 'DAYS', startDate: '2026-11-10', endDate: '', reason: '  ' }, tz), { kind: 'DAYS', timeZone: tz, startDate: '2026-11-10', endDate: '2026-11-10' });
  assert.deepEqual(describeBlock({ startAt: '2026-11-09T21:00:00.000Z', endAt: '2026-11-11T21:00:00.000Z' }, tz), { kind: 'DAYS', startDate: '2026-11-10', endDate: '2026-11-11' });
  assert.deepEqual(describeBlock({ startAt: '2026-11-10T07:00:00.000Z', endAt: '2026-11-10T09:00:00.000Z' }, tz), { kind: 'PERIOD', date: '2026-11-10', endDate: '2026-11-10', startTime: '10:00', endTime: '12:00' });
  assert.equal(availabilityErrorKey({ code: 'BLOCK_OVERLAP' }), 'availability.apiErrors.BLOCK_OVERLAP');
  assert.equal(availabilityErrorKey({ code: 'WHATEVER' }), 'availability.apiErrors.GENERIC');
});

test('times are shown in an explicit zone, never the browser or server default', () => {
  const iso = '2026-11-10T22:30:00.000Z';
  assert.equal(wallTime(iso, 'Africa/Mogadishu'), '01:30');
  assert.equal(wallTime(iso, 'America/New_York'), '17:30');
  assert.equal(todayIn('Africa/Mogadishu', new Date(iso)), '2026-11-11');
  assert.equal(todayIn('UTC', new Date(iso)), '2026-11-10');
  assert.equal(formatTime(iso, 'Africa/Mogadishu', 'en-US').replace(/\s/g, ' '), '1:30 AM');
  assert.equal(zoneOffsetLabel('Africa/Mogadishu'), 'GMT+3');
  assert.equal(zoneOffsetLabel('Europe/London', new Date('2026-07-01T12:00:00Z')), 'GMT+1');
  assert.equal(addCivilDays('2026-03-28', 2), '2026-03-30', 'civil arithmetic unaffected by DST');
});

test('directory query: URL params become API filters, with safe fallbacks', () => {
  const specialties = [{ id: '11111111-2222-4333-8444-555555555555', nameEn: 'Cardiology' }];
  const q = (s) => directoryQuery(new URLSearchParams(s), specialties);
  assert.deepEqual(q(''), { q: undefined, specialtyId: undefined, language: undefined, sort: 'rating', page: 1, pageSize: 12 });
  assert.deepEqual(q('q=%20hodan%20&specialty=cardiology&language=so&fee=15to30&sort=priceLow&page=2'), {
    q: 'hodan',
    specialtyId: specialties[0].id,
    language: 'so',
    minFee: 15,
    maxFee: 30,
    sort: 'priceLow',
    page: 2,
    pageSize: 12,
  });
  assert.equal(q('sort=hack&fee=free').sort, 'rating');
  assert.equal(q('page=-4').page, 1);
  assert.equal(resolveSpecialty('unknownKey', specialties), '');
  assert.equal(resolveSpecialty(specialties[0].id, specialties), specialties[0].id);
  assert.equal(formatFee('25.00'), '$25');
  assert.equal(formatFee('25.50'), '$25.50');
});
