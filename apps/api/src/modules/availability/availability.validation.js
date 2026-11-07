import { z } from 'zod';
import { isValidTimeZone, timeToMinutes } from '../../utils/timezone.js';
import { MAX_BLOCK_DAYS, MAX_PERIODS_PER_DAY, MAX_SLOT_QUERY_DAYS, SLOT_DURATIONS } from './availability.constants.js';

/** Strict Zod schemas (unknown fields rejected — no mass assignment). */

const timeZone = z.string().refine(isValidTimeZone, 'Choose a valid time zone');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
export const civilDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Enter a real date');
const uuid = z.string().uuid();
const duration = z.coerce.number().refine((v) => SLOT_DURATIONS.includes(v), `Consultation length must be ${SLOT_DURATIONS.join(' or ')} minutes`);

const period = z
  .object({ startTime: hhmm, endTime: hhmm })
  .strict()
  .refine((p) => timeToMinutes(p.startTime) < timeToMinutes(p.endTime), { message: 'End time must be after the start time', path: ['endTime'] });

export const scheduleSchema = z
  .object({
    timeZone,
    slotDurationMinutes: duration,
    days: z
      .array(
        z
          .object({ dayOfWeek: z.number().int().min(0).max(6), periods: z.array(period).max(MAX_PERIODS_PER_DAY) })
          .strict(),
      )
      .max(7),
  })
  .strict()
  .superRefine((s, ctx) => {
    const seen = new Set();
    s.days.forEach((d, i) => {
      if (seen.has(d.dayOfWeek)) ctx.addIssue({ code: 'custom', path: ['days', i, 'dayOfWeek'], message: 'Each day can appear only once' });
      seen.add(d.dayOfWeek);
      const sorted = d.periods.map((p, j) => ({ ...p, j, s: timeToMinutes(p.startTime), e: timeToMinutes(p.endTime) })).sort((a, b) => a.s - b.s);
      sorted.forEach((p, k) => {
        if (p.e - p.s < s.slotDurationMinutes) ctx.addIssue({ code: 'custom', path: ['days', i, 'periods', p.j, 'endTime'], message: 'A period must fit at least one consultation' });
        if (k > 0 && p.s < sorted[k - 1].e) ctx.addIssue({ code: 'custom', path: ['days', i, 'periods', p.j, 'startTime'], message: 'Working periods on the same day cannot overlap' });
      });
    });
  });

export const ruleIdParamsSchema = z.object({ ruleId: uuid }).strict();
export const blockIdParamsSchema = z.object({ blockId: uuid }).strict();

const reason = z.string().trim().max(255).optional();

export const blockSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('DAYS'), timeZone, startDate: civilDate, endDate: civilDate, reason })
    .strict()
    .refine((b) => b.endDate >= b.startDate, { message: 'End date must be on or after the start date', path: ['endDate'] })
    .refine((b) => (Date.parse(b.endDate) - Date.parse(b.startDate)) / 86_400_000 < MAX_BLOCK_DAYS, { message: `A block can cover at most ${MAX_BLOCK_DAYS} days`, path: ['endDate'] }),
  z
    .object({ kind: z.literal('PERIOD'), timeZone, date: civilDate, startTime: hhmm, endTime: hhmm, reason })
    .strict()
    .refine((b) => timeToMinutes(b.startTime) < timeToMinutes(b.endTime), { message: 'End time must be after the start time', path: ['endTime'] }),
]);

/** Calendar/slot range queries: days are counted in the given zone, starting at `from`. */
export const slotRangeQuerySchema = z
  .object({
    from: civilDate.optional(),
    days: z.coerce.number().int().min(1).max(MAX_SLOT_QUERY_DAYS).default(7),
    tz: timeZone.optional(),
  })
  .strict();

export const emptyBodySchema = z.object({}).strict();
