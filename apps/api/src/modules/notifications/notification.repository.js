import { qualifiedTable } from '../../utils/sql.js';

/** Data access for notifications, push subscriptions, preferences and reminders. Every read is user-scoped. */

/* ------------------------------------------------------------ legacy helpers (kept for compatibility) */
export const createNotification = (client, { userId, type, title, body, data }) =>
  client.notification.create({ data: { userId, type, title, body, data } });

export const createNotifications = (client, notifications) =>
  notifications.length ? client.notification.createMany({ data: notifications }) : Promise.resolve({ count: 0 });

/* ------------------------------------------------------------------ notifications */

/** Inserts; rows whose (user, event key) already exists are skipped (duplicate events). */
export const insertNotifications = (client, rows) =>
  rows.length ? client.notification.createMany({ data: rows, skipDuplicates: true }) : Promise.resolve({ count: 0 });

export const findRecipients = (client, userIds) =>
  client.user.findMany({ where: { id: { in: userIds } }, select: { id: true, phone: true, preferredLanguage: true, timeZone: true, notificationPreference: true } });

const LIST_SELECT = Object.freeze({ id: true, type: true, title: true, body: true, data: true, readAt: true, createdAt: true });

/** Newest first; keyset pagination on (createdAt, id). */
export function listForUser(client, userId, { unreadOnly = false, before = null, limit = 20 }) {
  const where = { userId, ...(unreadOnly ? { readAt: null } : {}) };
  if (before) {
    where.OR = [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }];
  }
  return client.notification.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, select: LIST_SELECT });
}

export const findOwned = (client, userId, id) => client.notification.findFirst({ where: { id, userId }, select: LIST_SELECT });

export const countUnread = (client, userId) => client.notification.count({ where: { userId, readAt: null } });

export const setRead = (client, userId, id, readAt) => client.notification.updateMany({ where: { id, userId }, data: { readAt } });

export const markAllRead = (client, userId, at) => client.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: at } });

export const deleteOwned = (client, userId, id) => client.notification.deleteMany({ where: { id, userId } });

/** Claims notifications waiting for real-time/push delivery (safe with several API instances). */
export async function claimPendingDispatch(tx, limit) {
  const rows = await tx.$queryRawUnsafe(
    `SELECT id FROM ${qualifiedTable('notifications')} WHERE dispatch_pending = true ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
    limit,
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  await tx.notification.updateMany({ where: { id: { in: ids } }, data: { dispatchPending: false } });
  return tx.notification.findMany({
    where: { id: { in: ids } },
    select: { ...LIST_SELECT, userId: true, readAt: true, user: { select: { preferredLanguage: true, timeZone: true, notificationPreference: true } } },
  });
}

/* --------------------------------------------------------------- preferences */
export const findPreference = (client, userId) => client.notificationPreference.findUnique({ where: { userId } });

export const upsertPreference = (client, userId, data) =>
  client.notificationPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data });

/* ---------------------------------------------------------- push subscriptions */
export const listSubscriptions = (client, userId) => client.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });

export const findSubscriptionByEndpoint = (client, endpoint) => client.pushSubscription.findUnique({ where: { endpoint } });

/** The same browser endpoint moves to whoever signs in and enables push on it. */
export const upsertSubscription = (client, { userId, endpoint, p256dh, auth, userAgent }) =>
  client.pushSubscription.upsert({
    where: { endpoint },
    create: { userId, endpoint, p256dh, auth, userAgent },
    update: { userId, p256dh, auth, userAgent, lastUsedAt: null },
  });

export const deleteSubscriptionForUser = (client, userId, endpoint) => client.pushSubscription.deleteMany({ where: { userId, endpoint } });

export const deleteSubscriptionById = (client, id) => client.pushSubscription.deleteMany({ where: { id } });

export const touchSubscription = (client, id, at) => client.pushSubscription.updateMany({ where: { id }, data: { lastUsedAt: at } });

export const countSubscriptions = (client, userId) => client.pushSubscription.count({ where: { userId } });
