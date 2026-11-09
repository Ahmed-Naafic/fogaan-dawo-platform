/** Data access for availability rules, blocked periods and published slots (the only Prisma code here). */

/** Appointment statuses that occupy a doctor's time (a new slot must never overlap them). */
const ACTIVE_APPOINTMENT_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'WAITING', 'IN_PROGRESS'];

/** Data access: find doctor for availability (doctorProfile.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findDoctorForAvailability = (client, userId) =>
  client.doctorProfile.findUnique({
    where: { userId },
    select: { id: true, userId: true, verificationStatus: true, accountStatus: true, user: { select: { status: true, timeZone: true } } },
  });

/** Data access: find doctor for sync (doctorProfile.findUnique: one row by unique key). `client` is the Prisma client or a transaction. */
export const findDoctorForSync = (client, doctorId) =>
  client.doctorProfile.findUnique({
    where: { id: doctorId },
    select: { id: true, userId: true, verificationStatus: true, accountStatus: true, user: { select: { status: true, timeZone: true } } },
  });

/** Data access: list active rules (availabilityRule.findMany: matching rows). `client` is the Prisma client or a transaction. */
export const listActiveRules = (client, doctorId) =>
  client.availabilityRule.findMany({ where: { doctorId, isActive: true }, orderBy: [{ dayOfWeek: 'asc' }, { startLocalTime: 'asc' }] });

/** Data access: create rules (availabilityRule.createMany: inserts rows). `client` is the Prisma client or a transaction. */
export const createRules = (client, rows) => (rows.length ? client.availabilityRule.createMany({ data: rows }) : { count: 0 });

/** Data access: deactivate rules (availabilityRule.updateMany: updates matching rows). `client` is the Prisma client or a transaction. */
export const deactivateRules = (client, doctorId, ids, effectiveUntil) =>
  ids.length ? client.availabilityRule.updateMany({ where: { doctorId, id: { in: ids }, isActive: true }, data: { isActive: false, effectiveUntil } }) : { count: 0 };

/** Data access: find active rule for doctor (availabilityRule.findFirst: first matching row). `client` is the Prisma client or a transaction. */
export const findActiveRuleForDoctor = (client, doctorId, ruleId) => client.availabilityRule.findFirst({ where: { id: ruleId, doctorId, isActive: true } });

/** Data access: list blocks (blockedDate.findMany: matching rows). `client` is the Prisma client or a transaction. */
export const listBlocks = (client, doctorId, { endAfter, startBefore } = {}) =>
  client.blockedDate.findMany({
    where: { doctorId, ...(endAfter ? { endAt: { gt: endAfter } } : {}), ...(startBefore ? { startAt: { lt: startBefore } } : {}) },
    orderBy: { startAt: 'asc' },
  });

/** Data access: find block for doctor (blockedDate.findFirst: first matching row). `client` is the Prisma client or a transaction. */
export const findBlockForDoctor = (client, doctorId, blockId) => client.blockedDate.findFirst({ where: { id: blockId, doctorId } });

/** Data access: find overlapping block (blockedDate.findFirst: first matching row). `client` is the Prisma client or a transaction. */
export const findOverlappingBlock = (client, doctorId, startAt, endAt) =>
  client.blockedDate.findFirst({ where: { doctorId, startAt: { lt: endAt }, endAt: { gt: startAt } } });

/** Data access: create block (blockedDate.create: inserts a row). `client` is the Prisma client or a transaction. */
export const createBlock = (client, data) => client.blockedDate.create({ data });

/** Data access: delete block (blockedDate.delete: deletes a row). `client` is the Prisma client or a transaction. */
export const deleteBlock = (client, id) => client.blockedDate.delete({ where: { id } });

/** Slots that have not ended yet, with how many appointments reference them. */
export async function findUnfinishedSlots(client, doctorId, now) {
  const rows = await client.availabilitySlot.findMany({
    where: { doctorId, endAtUtc: { gt: now } },
    select: { id: true, startAtUtc: true, endAtUtc: true, sourceRuleId: true, status: true, _count: { select: { appointments: true } } },
  });
  return rows.map(({ _count, ...s }) => ({ ...s, appointmentCount: _count.appointments }));
}

/** Data access: find busy appointments (appointment.findMany: matching rows). `client` is the Prisma client or a transaction. */
export const findBusyAppointments = (client, doctorId, now) =>
  client.appointment.findMany({ where: { doctorId, endAtUtc: { gt: now }, status: { in: ACTIVE_APPOINTMENT_STATUSES } }, select: { startAtUtc: true, endAtUtc: true } });

/** Deletes only unbooked, still-AVAILABLE slots (the WHERE re-checks it, whatever ids are passed). */
export const deleteReplaceableSlots = (client, doctorId, ids, now) =>
  ids.length
    ? client.availabilitySlot.deleteMany({ where: { id: { in: ids }, doctorId, status: 'AVAILABLE', startAtUtc: { gt: now }, appointments: { none: {} } } })
    : { count: 0 };

/** Data access: create slots (availabilitySlot.createMany: inserts rows). `client` is the Prisma client or a transaction. */
export const createSlots = (client, rows) => (rows.length ? client.availabilitySlot.createMany({ data: rows }) : { count: 0 });

/** Data access: list slots in range (availabilitySlot.findMany: matching rows). `client` is the Prisma client or a transaction. */
export const listSlotsInRange = (client, doctorId, { from, to, statuses, startAfter }) =>
  client.availabilitySlot.findMany({
    where: {
      doctorId,
      startAtUtc: { gte: startAfter && startAfter > from ? startAfter : from, lt: to },
      ...(statuses ? { status: { in: statuses } } : {}),
    },
    select: { id: true, startAtUtc: true, endAtUtc: true, status: true },
    orderBy: { startAtUtc: 'asc' },
  });

/** Data access: update user time zone (user.update: updates a row). `client` is the Prisma client or a transaction. */
export const updateUserTimeZone = (client, userId, timeZone) => client.user.update({ where: { id: userId }, data: { timeZone } });

/** Data access: list bookable doctor ids (doctorProfile.findMany: matching rows). `client` is the Prisma client or a transaction. */
export const listBookableDoctorIds = (client, where) => client.doctorProfile.findMany({ where, select: { id: true } });

/** Data access: list doctor ids with replaceable slots (availabilitySlot.findMany: matching rows). `client` is the Prisma client or a transaction. */
export const listDoctorIdsWithReplaceableSlots = (client, now) =>
  client.availabilitySlot.findMany({ where: { status: 'AVAILABLE', startAtUtc: { gt: now } }, select: { doctorId: true }, distinct: ['doctorId'] });
