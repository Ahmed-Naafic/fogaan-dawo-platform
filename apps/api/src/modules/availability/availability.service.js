import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import { addDays, dateInZone, minutesToTime, startOfDayUtc, timeToMinutes, zonedTimeToUtc } from '../../utils/timezone.js';
import * as auditRepository from '../audit/audit.repository.js';
import { BOOKABLE_DOCTOR_WHERE } from '../doctors/doctor.constants.js';
import { AvailabilityErrorCode as Code, MAX_BLOCK_START_AHEAD_DAYS, SLOT_HORIZON_DAYS } from './availability.constants.js';
import * as repo from './availability.repository.js';
import { overlaps, planSlots, reconcileSlots } from './availability.slots.js';

/**
 * Doctor availability: weekly rules (wall-clock times in the doctor's IANA zone), blocked periods
 * (UTC instants) and generated slots (UTC). Every change re-plans the doctor's slots in the same
 * transaction, under a lock on the doctor row, so concurrent edits cannot create duplicates.
 */

const DAY_MS = 86_400_000;

const isBookable = (d) => d.verificationStatus === 'VERIFIED' && d.accountStatus === 'ACTIVE' && d.user.status === 'ACTIVE';

/* ------------------------------------------------------------ presentation */

const timeOf = (dbTime) => dbTime.getUTCHours() * 60 + dbTime.getUTCMinutes();
const dbTime = (minutes) => new Date(Date.UTC(1970, 0, 1, Math.floor(minutes / 60), minutes % 60));
const dbDate = (dateString) => new Date(`${dateString}T00:00:00Z`);

const presentRule = (r) => ({
  id: r.id,
  dayOfWeek: r.dayOfWeek,
  startTime: minutesToTime(timeOf(r.startLocalTime)),
  endTime: minutesToTime(timeOf(r.endLocalTime)),
  slotDurationMinutes: r.slotDurationMinutes,
  timeZone: r.timeZone,
});
const presentBlock = (b) => ({ id: b.id, startAt: b.startAt.toISOString(), endAt: b.endAt.toISOString(), reason: b.reason ?? null });
const presentSlot = (s) => ({ id: s.id, startAtUtc: s.startAtUtc.toISOString(), endAtUtc: s.endAtUtc.toISOString(), status: s.status });

const toPlanRule = (r) => ({
  id: r.id,
  dayOfWeek: r.dayOfWeek,
  startMinutes: timeOf(r.startLocalTime),
  endMinutes: timeOf(r.endLocalTime),
  slotDurationMinutes: r.slotDurationMinutes,
  timeZone: r.timeZone,
  effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
  effectiveUntil: r.effectiveUntil ? r.effectiveUntil.toISOString().slice(0, 10) : null,
});

/** The schedule's zone: the rules' zone if any, else the doctor's account zone. */
const scheduleZone = (rules, doctor) => rules[0]?.timeZone ?? doctor.user.timeZone ?? 'Africa/Mogadishu';

/** Groups slots by civil date in `timeZone` (date boundaries are computed in that zone, never the server's). */
export function groupSlotsByDay(slots, timeZone, fromDate, days) {
  const byDate = new Map(Array.from({ length: days }, (_, i) => [addDays(fromDate, i), []]));
  for (const s of slots) byDate.get(dateInZone(s.startAtUtc, timeZone))?.push(s);
  return [...byDate].map(([date, list]) => ({ date, slots: list.map(presentSlot) }));
}

/* ------------------------------------------------------------ guards */

async function doctorFor(client, auth) {
  const doctor = await repo.findDoctorForAvailability(client, auth.user.id);
  if (!doctor) throw ApiError.notFound('Doctor profile not found');
  return doctor;
}

/** Locks the doctor row and requires a verified, active doctor (pending, rejected or suspended → 403). */
async function lockManageableDoctor(tx, auth) {
  const doctor = await doctorFor(tx, auth);
  await lockRow(tx, 'doctor_profiles', doctor.id);
  const fresh = await repo.findDoctorForSync(tx, doctor.id);
  if (!isBookable(fresh)) throw ApiError.forbidden('Only verified, active doctors can manage availability', undefined, Code.DOCTOR_NOT_BOOKABLE);
  return fresh;
}

/* ------------------------------------------------------------ slot sync */

/**
 * Re-plans one doctor's future slots from their active rules and blocks. Idempotent: running it twice
 * changes nothing. Never touches held/booked slots or slots with appointments; never creates slots
 * that overlap them. A doctor who is not verified + active has every replaceable slot withdrawn.
 * Must run inside a transaction that holds the doctor row lock.
 */
export async function syncDoctorSlots(tx, doctor, now = new Date()) {
  let planned = [];
  if (isBookable(doctor)) {
    const rules = (await repo.listActiveRules(tx, doctor.id)).map(toPlanRule);
    const blocks = await repo.listBlocks(tx, doctor.id, { endAfter: now, startBefore: new Date(now.getTime() + (SLOT_HORIZON_DAYS + 2) * DAY_MS) });
    planned = planSlots({ rules, blocks, now });
  }
  const existing = await repo.findUnfinishedSlots(tx, doctor.id, now);
  const busy = await repo.findBusyAppointments(tx, doctor.id, now);
  const { create, remove } = reconcileSlots({ planned, existing, busy, now });
  const removed = await repo.deleteReplaceableSlots(tx, doctor.id, remove, now);
  const created = await repo.createSlots(
    tx,
    create.map((s) => ({ doctorId: doctor.id, sourceRuleId: s.sourceRuleId, startAtUtc: s.startAtUtc, endAtUtc: s.endAtUtc, timeZoneSnapshot: s.timeZone })),
  );
  return { created: created.count, removed: removed.count };
}

/** Daily job: rolls every doctor's slot window forward and withdraws slots of doctors who are no longer bookable. */
export async function syncAllDoctorSlots({ now = new Date(), client = prisma } = {}) {
  const ids = new Set([
    ...(await repo.listBookableDoctorIds(client, BOOKABLE_DOCTOR_WHERE)).map((d) => d.id),
    ...(await repo.listDoctorIdsWithReplaceableSlots(client, now)).map((d) => d.doctorId),
  ]);
  const totals = { doctors: 0, created: 0, removed: 0 };
  for (const id of ids) {
    const result = await withTransaction(async (tx) => {
      await lockRow(tx, 'doctor_profiles', id);
      return syncDoctorSlots(tx, await repo.findDoctorForSync(tx, id), now);
    }, { client });
    totals.doctors += 1;
    totals.created += result.created;
    totals.removed += result.removed;
  }
  return totals;
}

/* ------------------------------------------------------------ doctor: read */

export async function getMyAvailability(auth, now = new Date()) {
  const doctor = await doctorFor(prisma, auth);
  const rules = await repo.listActiveRules(prisma, doctor.id);
  const blocks = await repo.listBlocks(prisma, doctor.id, { endAfter: now });
  const timeZone = scheduleZone(rules, doctor);
  return {
    canManage: isBookable(doctor),
    verificationStatus: doctor.verificationStatus,
    accountStatus: doctor.accountStatus,
    timeZone,
    slotDurationMinutes: rules[0]?.slotDurationMinutes ?? 30,
    horizonDays: SLOT_HORIZON_DAYS,
    rules: rules.map(presentRule),
    blocks: blocks.map(presentBlock),
  };
}

/** The doctor's own calendar: every slot (any status) and block in [from, from + days) in the schedule's zone. */
export async function getMyCalendar(auth, { from, days, tz }, now = new Date()) {
  const doctor = await doctorFor(prisma, auth);
  const rules = await repo.listActiveRules(prisma, doctor.id);
  const timeZone = tz ?? scheduleZone(rules, doctor);
  const fromDate = from ?? dateInZone(now, timeZone);
  const start = startOfDayUtc(fromDate, timeZone);
  const end = startOfDayUtc(addDays(fromDate, days), timeZone);
  const slots = await repo.listSlotsInRange(prisma, doctor.id, { from: start, to: end });
  const blocks = await repo.listBlocks(prisma, doctor.id, { endAfter: start, startBefore: end });
  return { timeZone, from: fromDate, days: groupSlotsByDay(slots, timeZone, fromDate, days), blocks: blocks.map(presentBlock) };
}

/* ------------------------------------------------------------ doctor: write */

const ruleKey = (r) => `${r.dayOfWeek}|${r.startMinutes}|${r.endMinutes}|${r.slotDurationMinutes}|${r.timeZone}`;

/**
 * Replaces the weekly schedule ("Save changes"). Unchanged periods keep their rule (and its slots);
 * removed or edited periods are deactivated (kept for history); new periods become new rules.
 */
export async function saveMySchedule(auth, input, now = new Date()) {
  return withTransaction(async (tx) => {
    const doctor = await lockManageableDoctor(tx, auth);
    const today = dateInZone(now, input.timeZone);
    const current = await repo.listActiveRules(tx, doctor.id);
    const wanted = input.days.flatMap((d) =>
      d.periods.map((p) => ({
        dayOfWeek: d.dayOfWeek,
        startMinutes: timeToMinutes(p.startTime),
        endMinutes: timeToMinutes(p.endTime),
        slotDurationMinutes: input.slotDurationMinutes,
        timeZone: input.timeZone,
      })),
    );
    const currentByKey = new Map(current.map((r) => [ruleKey(toPlanRule(r)), r]));
    const wantedKeys = new Set(wanted.map(ruleKey));
    const toDeactivate = current.filter((r) => !wantedKeys.has(ruleKey(toPlanRule(r)))).map((r) => r.id);
    const toCreate = wanted.filter((w) => !currentByKey.has(ruleKey(w)));

    await repo.deactivateRules(tx, doctor.id, toDeactivate, dbDate(today));
    await repo.createRules(
      tx,
      toCreate.map((w) => ({
        doctorId: doctor.id,
        dayOfWeek: w.dayOfWeek,
        startLocalTime: dbTime(w.startMinutes),
        endLocalTime: dbTime(w.endMinutes),
        timeZone: w.timeZone,
        slotDurationMinutes: w.slotDurationMinutes,
        effectiveFrom: dbDate(today),
      })),
    );
    if (doctor.user.timeZone !== input.timeZone) await repo.updateUserTimeZone(tx, doctor.userId, input.timeZone);
    const slots = await syncDoctorSlots(tx, doctor, now);
    await auditRepository.createAuditLog(tx, {
      actorUserId: auth.user.id,
      action: 'UPDATE',
      entityType: 'AvailabilitySchedule',
      entityId: doctor.id,
      oldValues: { rules: current.map(presentRule).map(({ id, ...r }) => r) },
      newValues: { timeZone: input.timeZone, slotDurationMinutes: input.slotDurationMinutes, periods: wanted.length, added: toCreate.length, removed: toDeactivate.length, slots },
    });
    return { slots };
  }).then(async (result) => ({ ...(await getMyAvailability(auth, now)), ...result }));
}

/** Removes one weekly period (soft: the rule is deactivated so past slots keep their source). */
export async function deleteMyRule(auth, ruleId, now = new Date()) {
  return withTransaction(async (tx) => {
    const doctor = await lockManageableDoctor(tx, auth);
    const rule = await repo.findActiveRuleForDoctor(tx, doctor.id, ruleId);
    if (!rule) throw new ApiError(404, 'Availability period not found', undefined, Code.RULE_NOT_FOUND);
    await repo.deactivateRules(tx, doctor.id, [rule.id], dbDate(dateInZone(now, rule.timeZone)));
    const slots = await syncDoctorSlots(tx, doctor, now);
    await auditRepository.createAuditLog(tx, { actorUserId: auth.user.id, action: 'DELETE', entityType: 'AvailabilityRule', entityId: rule.id, oldValues: presentRule(rule), newValues: { slots } });
    return { slots };
  }).then(async (result) => ({ ...(await getMyAvailability(auth, now)), ...result }));
}

/** Converts a block request (wall-clock in its zone) to a UTC range. */
function blockRange(input) {
  if (input.kind === 'DAYS') {
    return { startAt: startOfDayUtc(input.startDate, input.timeZone), endAt: startOfDayUtc(addDays(input.endDate, 1), input.timeZone) };
  }
  const startAt = zonedTimeToUtc(input.date, timeToMinutes(input.startTime), input.timeZone);
  const endAt = zonedTimeToUtc(input.date, timeToMinutes(input.endTime), input.timeZone);
  if (!startAt || !endAt) throw ApiError.badRequest('That time does not exist on this date (daylight-saving change)', [{ path: 'startTime', message: 'Time skipped by daylight saving' }], 'VALIDATION_ERROR');
  return { startAt, endAt };
}

export async function addMyBlock(auth, input, now = new Date()) {
  return withTransaction(async (tx) => {
    const doctor = await lockManageableDoctor(tx, auth); // permission first, then the range checks
    const { startAt, endAt } = blockRange(input);
    if (endAt <= now) throw ApiError.badRequest('This period has already passed', [{ path: input.kind === 'DAYS' ? 'endDate' : 'endTime', message: 'Already passed' }], Code.BLOCK_IN_PAST);
    if (startAt.getTime() > now.getTime() + MAX_BLOCK_START_AHEAD_DAYS * DAY_MS) throw ApiError.badRequest('Blocks can start at most one year ahead', [{ path: input.kind === 'DAYS' ? 'startDate' : 'date', message: 'Too far ahead' }], 'VALIDATION_ERROR');
    if (await repo.findOverlappingBlock(tx, doctor.id, startAt, endAt)) throw ApiError.conflict('This overlaps a period you have already blocked', undefined, Code.BLOCK_OVERLAP);
    const block = await repo.createBlock(tx, { doctorId: doctor.id, startAt, endAt, reason: input.reason || null });
    const slots = await syncDoctorSlots(tx, doctor, now);
    const unfinished = await repo.findUnfinishedSlots(tx, doctor.id, now);
    const keptBooked = unfinished.filter((s) => (s.status !== 'AVAILABLE' || s.appointmentCount > 0) && overlaps(s.startAtUtc, s.endAtUtc, startAt, endAt)).length;
    await auditRepository.createAuditLog(tx, { actorUserId: auth.user.id, action: 'CREATE', entityType: 'BlockedDate', entityId: block.id, newValues: { ...presentBlock(block), kind: input.kind, timeZone: input.timeZone, slots, keptBooked } });
    return { block: presentBlock(block), slots, keptBooked };
  }).then(async (result) => ({ ...(await getMyAvailability(auth, now)), ...result }));
}

/** Removes a block that has not ended yet (past blocks stay as history). */
export async function removeMyBlock(auth, blockId, now = new Date()) {
  return withTransaction(async (tx) => {
    const doctor = await lockManageableDoctor(tx, auth);
    const block = await repo.findBlockForDoctor(tx, doctor.id, blockId);
    if (!block) throw new ApiError(404, 'Blocked period not found', undefined, Code.BLOCK_NOT_FOUND);
    if (block.endAt <= now) throw ApiError.conflict('Past blocked periods are kept as history', undefined, Code.BLOCK_IN_PAST);
    await repo.deleteBlock(tx, block.id);
    const slots = await syncDoctorSlots(tx, doctor, now);
    await auditRepository.createAuditLog(tx, { actorUserId: auth.user.id, action: 'DELETE', entityType: 'BlockedDate', entityId: block.id, oldValues: presentBlock(block), newValues: { slots } });
    return { slots };
  }).then(async (result) => ({ ...(await getMyAvailability(auth, now)), ...result }));
}
