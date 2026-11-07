import { prisma } from '../../config/database.js';
import { ApiError } from '../../utils/ApiError.js';
import { lockRow, withTransaction } from '../../utils/transaction.js';
import * as auditRepository from '../audit/audit.repository.js';
import { percentFromFraction } from '../finance/finance.calc.js';
import { assertValidPolicy, BOOKING_POLICY_KEY, BOOKING_POLICY_LIMITS, BookingPolicyErrorCode, DEFAULT_BOOKING_POLICY, mergePolicy } from '../settings/bookingPolicy.js';
import { SettingKey } from '../settings/setting.service.js';

/**
 * Admin › Settings: the booking rules (payment hold, follow-up payment deadline, free reschedules and
 * their cut-off, refund cut-offs). The commission rate is shown read-only — it is changed in Admin ›
 * Finance › Settings, which has its own confirmation and history.
 */

const history = (client) =>
  client.auditLog.findMany({
    where: { entityType: 'PlatformSetting', entityId: BOOKING_POLICY_KEY },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { oldValues: true, newValues: true, createdAt: true, actor: { select: { fullName: true } } },
  });

/** GET /api/v1/admin/settings */
export async function getSettings(client = prisma) {
  const [row, commission, changes] = await Promise.all([
    client.platformSetting.findUnique({ where: { key: BOOKING_POLICY_KEY }, include: { updatedByUser: { select: { fullName: true } } } }),
    client.platformSetting.findUnique({ where: { key: SettingKey.commissionRate } }),
    history(client),
  ]);
  return {
    bookingPolicy: {
      values: mergePolicy(row?.value),
      defaults: DEFAULT_BOOKING_POLICY,
      limits: BOOKING_POLICY_LIMITS,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      updatedBy: row?.updatedByUser?.fullName ?? null,
      history: changes.map((c) => ({ at: c.createdAt.toISOString(), by: c.actor?.fullName ?? null, before: c.oldValues ?? null, after: c.newValues ?? null })),
    },
    commission: { percent: commission?.value?.rate != null ? percentFromFraction(commission.value.rate) : null, managedIn: '/admin/finance/settings' },
  };
}

/** PUT /api/v1/admin/settings/booking-policy — all six values; validated, confirmed, audited. */
export async function updateBookingPolicy({ adminUserId, values }, client = prisma) {
  assertValidPolicy(values);
  await withTransaction(
    async (tx) => {
      const existing = await tx.platformSetting.findUnique({ where: { key: BOOKING_POLICY_KEY } });
      if (existing) await lockRow(tx, 'platform_settings', existing.id);
      const before = mergePolicy(existing?.value);
      const next = Object.fromEntries(Object.keys(DEFAULT_BOOKING_POLICY).map((k) => [k, values[k]]));
      if (Object.keys(next).every((k) => next[k] === before[k])) throw ApiError.conflict('Nothing changed', undefined, BookingPolicyErrorCode.UNCHANGED);
      await tx.platformSetting.upsert({
        where: { key: BOOKING_POLICY_KEY },
        update: { value: next, updatedBy: adminUserId },
        create: { key: BOOKING_POLICY_KEY, value: next, description: 'Booking rules (Admin › Settings)', updatedBy: adminUserId },
      });
      const changedOnly = (src) => Object.fromEntries(Object.keys(next).filter((k) => next[k] !== before[k]).map((k) => [k, src[k]]));
      await auditRepository.createAuditLog(tx, { actorUserId: adminUserId, action: 'UPDATE', entityType: 'PlatformSetting', entityId: BOOKING_POLICY_KEY, oldValues: changedOnly(before), newValues: changedOnly(next) });
    },
    { client },
  );
  return getSettings(client);
}
