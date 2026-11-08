import { getPushConfig, isAllowedPushEndpoint } from '../../config/push.js';
import { isSmsKind, queueSms } from './sms.service.js';
import { prisma } from '../../config/database.js';
import { sendWebPush } from '../../adapters/push/webPushSender.js';
import { ApiError } from '../../utils/ApiError.js';
import { isValidTimeZone } from '../../utils/timezone.js';
import { withTransaction } from '../../utils/transaction.js';
import { NOTIFICATION_KINDS, notificationUrl, renderNotification, SUPPORTED_LANGUAGES } from './notification.catalog.js';
import * as repo from './notification.repository.js';
import * as realtime from './notification.realtime.js';

/**
 * Notifications are created only by backend services, inside the same transaction as the event they
 * describe (so a rolled-back booking never notifies anyone). Each carries a stable event key: the same
 * event for the same user is stored once, however often the code path runs.
 *
 * Delivery is an outbox: rows are written with dispatch_pending = true and the dispatcher (every few
 * seconds, and in tests on demand) publishes them to open real-time streams and sends Web Push where
 * the user enabled it. A crash between commit and push loses at most the push, never the notification.
 */
export const NotificationErrorCode = Object.freeze({
  pushUnavailable: 'PUSH_UNAVAILABLE',
  pushEndpointNotAllowed: 'PUSH_ENDPOINT_NOT_ALLOWED',
  notFound: 'NOTIFICATION_NOT_FOUND',
});

const DEFAULT_PREFERENCES = Object.freeze({ inAppEnabled: true, pushEnabled: false, remindersEnabled: true });
const preferencesOf = (user) => ({ ...DEFAULT_PREFERENCES, ...(user?.notificationPreference ?? {}) });

/**
 * Creates one notification per recipient for an event.
 * recipients: [{ userId, role? }] — `role` is the recipient's side (PATIENT / DOCTOR / ADMIN), used for links.
 * eventKey: unique per event (e.g. `payment.confirmed:<paymentId>`); combined with the user it de-duplicates.
 */
export async function notify(tx, { kind, recipients, params = {}, eventKey }) {
  const meta = NOTIFICATION_KINDS[kind];
  if (!meta) throw new Error(`Unknown notification kind ${kind}`);
  if (!eventKey) throw new Error('eventKey is required');
  const list = recipients.filter((r) => r?.userId);
  if (!list.length) return { count: 0 };
  const users = new Map((await repo.findRecipients(tx, [...new Set(list.map((r) => r.userId))])).map((u) => [u.id, u]));
  const now = new Date();
  const rows = [];
  const sms = [];
  for (const { userId, role = null } of list) {
    const user = users.get(userId);
    if (!user) continue;
    const prefs = preferencesOf(user);
    // Optional notifications respect the in-app preference: kept as already read (no badge) but still pushed.
    const quietInApp = !meta.essential && !prefs.inAppEnabled;
    const fallback = renderNotification({ kind, params }, { lang: user.preferredLanguage, timeZone: user.timeZone });
    rows.push({
      userId,
      type: meta.type,
      title: fallback.title.slice(0, 180),
      body: fallback.body,
      data: { kind, params: { ...params, role } },
      eventKey: `${eventKey}`.slice(0, 160),
      readAt: quietInApp ? now : null,
      dispatchPending: true,
    });
    if (isSmsKind(kind)) sms.push({ userId, phone: user.phone ?? null, text: fallback.body });
  }
  const inserted = await repo.insertNotifications(tx, rows);
  // Same event key twice (e.g. a re-run job) inserts nothing — and sends no second SMS.
  if (sms.length && inserted.count > 0) await queueSms(tx, sms);
  return inserted;
}

/* --------------------------------------------------------------- presentation */

function readerContext({ lang, timeZone }) {
  return { lang: SUPPORTED_LANGUAGES.includes(lang) ? lang : 'en', timeZone: timeZone && isValidTimeZone(timeZone) ? timeZone : 'Africa/Mogadishu' };
}

/** Renders a stored notification for the reader (their language and time zone). Legacy rows keep their stored text. */
export function present(row, reader) {
  const kind = row.data?.kind;
  const params = row.data?.params ?? {};
  const rendered = kind ? renderNotification({ kind, params }, reader) : null;
  return {
    id: row.id,
    kind: kind ?? null,
    type: row.type,
    title: rendered?.title ?? row.title,
    body: rendered?.body ?? row.body,
    url: kind ? notificationUrl({ kind, params, role: params.role }) : '/account/notifications',
    read: row.readAt !== null,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}

/* ------------------------------------------------------------------- inbox API */

const cursorOf = (row) => Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
function parseCursor(cursor) {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/.test(id ?? '')) throw ApiError.badRequest('Invalid cursor');
  return { createdAt, id };
}

export async function listMine(auth, { unreadOnly, cursor, limit = 20, lang, timeZone }) {
  const rows = await repo.listForUser(prisma, auth.user.id, { unreadOnly, before: parseCursor(cursor), limit });
  const page = rows.slice(0, limit);
  const reader = readerContext({ lang, timeZone });
  return {
    items: page.map((r) => present(r, reader)),
    nextCursor: rows.length > limit ? cursorOf(page[page.length - 1]) : null,
    unreadCount: await repo.countUnread(prisma, auth.user.id),
  };
}

export const unreadCount = async (auth) => ({ unreadCount: await repo.countUnread(prisma, auth.user.id) });

async function afterChange(userId) {
  const count = await repo.countUnread(prisma, userId);
  realtime.publish(userId, { type: 'sync', unreadCount: count }); // other tabs/devices of the same user
  return count;
}

export async function setReadState(auth, id, read, now = new Date()) {
  const { count } = await repo.setRead(prisma, auth.user.id, id, read ? now : null);
  if (count === 0) throw new ApiError(404, 'Notification not found', undefined, NotificationErrorCode.notFound); // also for other users' ids
  return { id, read, unreadCount: await afterChange(auth.user.id) };
}

export async function readAll(auth, now = new Date()) {
  const { count } = await repo.markAllRead(prisma, auth.user.id, now);
  return { updated: count, unreadCount: await afterChange(auth.user.id) };
}

export async function deleteMine(auth, id) {
  const { count } = await repo.deleteOwned(prisma, auth.user.id, id);
  if (count === 0) throw new ApiError(404, 'Notification not found', undefined, NotificationErrorCode.notFound);
  return { deleted: true, unreadCount: await afterChange(auth.user.id) };
}

/** One notification for the stream (re-read so it is always the owner's own row). */
export async function presentOwned(userId, id, reader) {
  const row = await repo.findOwned(prisma, userId, id);
  return row ? present(row, readerContext(reader)) : null;
}

/* ----------------------------------------------------------------- preferences */

export async function getPreferences(auth) {
  const [pref, devices] = await Promise.all([repo.findPreference(prisma, auth.user.id), repo.countSubscriptions(prisma, auth.user.id)]);
  const config = getPushConfig();
  const { inAppEnabled, pushEnabled, remindersEnabled } = { ...DEFAULT_PREFERENCES, ...(pref ?? {}) };
  return { inAppEnabled, pushEnabled, remindersEnabled, push: { available: Boolean(config), publicKey: config?.publicKey ?? null, devices } };
}

export async function updatePreferences(auth, changes) {
  await repo.upsertPreference(prisma, auth.user.id, changes);
  return getPreferences(auth);
}

/* ------------------------------------------------------------ push subscriptions */

export async function subscribePush(auth, { endpoint, keys, userAgent }) {
  const config = getPushConfig();
  if (!config) throw new ApiError(503, 'Push notifications are not available', undefined, NotificationErrorCode.pushUnavailable);
  if (!isAllowedPushEndpoint(endpoint, config)) throw ApiError.badRequest('This push service is not supported', undefined, NotificationErrorCode.pushEndpointNotAllowed);
  await withTransaction(async (tx) => {
    await repo.upsertSubscription(tx, { userId: auth.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: userAgent ? String(userAgent).slice(0, 300) : null });
    await repo.upsertPreference(tx, auth.user.id, { pushEnabled: true });
  });
  return getPreferences(auth);
}

/** Removes this device's subscription. Push stays enabled for the user's other devices. */
export async function unsubscribePush(auth, { endpoint }) {
  await repo.deleteSubscriptionForUser(prisma, auth.user.id, endpoint);
  return getPreferences(auth);
}

/* -------------------------------------------------------------------- dispatch */

/** Sends one push to every device of a user; drops subscriptions the push service reports as gone. */
export async function pushToUser(userId, payload, { config = getPushConfig(), sender = sendWebPush, now = new Date() } = {}) {
  if (!config) return { sent: 0, removed: 0 };
  const subscriptions = await repo.listSubscriptions(prisma, userId);
  let sent = 0;
  let removed = 0;
  for (const sub of subscriptions) {
    const status = await sender(config, sub, payload, { topic: payload.tag?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) });
    if (status >= 200 && status < 300) {
      sent += 1;
      await repo.touchSubscription(prisma, sub.id, now);
    } else if (status === 404 || status === 410) {
      removed += 1; // expired / unsubscribed in the browser
      await repo.deleteSubscriptionById(prisma, sub.id);
    }
  }
  return { sent, removed };
}

/** Privacy-safe push payload: rendered title/body (names and times only), a relative link and a tag. */
export function pushPayloadFor(row) {
  const user = row.user ?? {};
  const view = present(row, readerContext({ lang: user.preferredLanguage, timeZone: user.timeZone }));
  return { title: view.title, body: view.body, url: view.url, tag: `fd-${row.id}`, notificationId: row.id };
}

/**
 * Delivers pending notifications: real-time event to the owner's open streams, then Web Push if the
 * owner enabled push. Returns how many notifications were handled.
 */
export async function dispatchPendingNotifications({ limit = 50, sender = sendWebPush } = {}) {
  const rows = await withTransaction((tx) => repo.claimPendingDispatch(tx, limit));
  const config = getPushConfig();
  for (const row of rows) {
    realtime.publish(row.userId, { type: 'notification', id: row.id });
    if (config && preferencesOf(row.user).pushEnabled) {
      try {
        await pushToUser(row.userId, pushPayloadFor(row), { config, sender });
      } catch (error) {
        console.error(`[api] push delivery failed: ${error.name}`);
      }
    }
  }
  return rows.length;
}
