import { EventEmitter } from 'node:events';

/**
 * In-process real-time hub for the notification stream (Server-Sent Events). There is no Socket.IO in
 * the project; SSE needs no extra dependency and works through the existing proxy. Events only say
 * "something changed" (with an id); the stream handler reads the row itself, scoped to its user.
 * Single API instance: several instances would need a shared bus (e.g. Postgres LISTEN/NOTIFY or Redis).
 */
const hub = new EventEmitter();
hub.setMaxListeners(0);

export function publish(userId, event) {
  hub.emit(`user:${userId}`, event);
}

export function subscribe(userId, listener) {
  hub.on(`user:${userId}`, listener);
  return () => hub.off(`user:${userId}`, listener);
}

export const listenerCount = (userId) => hub.listenerCount(`user:${userId}`);
