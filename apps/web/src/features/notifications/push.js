import { registerPushSubscription, removePushSubscription } from './services/notificationApi';

/**
 * Browser / installed-PWA push on this device. Permission is requested only from an explicit click.
 * The production service worker (/sw.js) shows the notifications; in development it is registered on
 * demand here (it never caches /api and only serves the app shell when offline).
 */
export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;

export const pushPermission = () => (pushSupported() ? Notification.permission : 'unsupported');

function keyBytes(base64url) {
  const padded = `${base64url}${'='.repeat((4 - (base64url.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration('/')) ?? navigator.serviceWorker.register('/sw.js');
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Asks for permission (must be called from a click), subscribes this browser and registers it with the API. */
export async function enablePushOnThisDevice(publicKey) {
  if (!pushSupported()) throw Object.assign(new Error('unsupported'), { code: 'PUSH_UNSUPPORTED' });
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw Object.assign(new Error('denied'), { code: 'PUSH_DENIED' });
  await registration();
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  return registerPushSubscription(sub.toJSON());
}

/** Unsubscribes this browser and removes it from the account. Best effort (used on sign-out too). */
export async function disablePushOnThisDevice() {
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return null;
  const { endpoint } = sub;
  await sub.unsubscribe().catch(() => {});
  return removePushSubscription(endpoint).catch(() => null);
}
