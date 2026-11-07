import * as service from './notification.service.js';
import * as realtime from './notification.realtime.js';

/** /api/v1/notifications — every handler acts on req.auth.user only (ownership is in the queries). */

export async function list(req, res) {
  const q = req.validatedQuery;
  res.json({ data: await service.listMine(req.auth, { unreadOnly: q.unread ?? false, cursor: q.cursor, limit: q.limit ?? 20, lang: q.lang, timeZone: q.tz }) });
}

export async function unread(req, res) {
  res.json({ data: await service.unreadCount(req.auth) });
}

export async function setRead(req, res) {
  res.json({ data: await service.setReadState(req.auth, req.params.id, req.body.read) });
}

export async function readAll(req, res) {
  res.json({ data: await service.readAll(req.auth) });
}

export async function remove(req, res) {
  res.json({ data: await service.deleteMine(req.auth, req.params.id) });
}

export async function getPreferences(req, res) {
  res.json({ data: await service.getPreferences(req.auth) });
}

export async function updatePreferences(req, res) {
  res.json({ data: await service.updatePreferences(req.auth, req.body) });
}

export async function subscribe(req, res) {
  res.status(201).json({ data: await service.subscribePush(req.auth, { ...req.body, userAgent: req.get('user-agent') }) });
}

export async function unsubscribe(req, res) {
  res.json({ data: await service.unsubscribePush(req.auth, req.body) });
}

/** Max life of one stream: shorter than an access token, so the client reconnects with a fresh one. */
const STREAM_MAX_MS = 10 * 60_000;
const HEARTBEAT_MS = 25_000;

/**
 * GET /stream — Server-Sent Events for the signed-in user: `ready`, `notification` (rendered for the
 * reader's language/time zone), `sync` (unread count changed elsewhere). Authenticated like any call
 * (Bearer token, read with fetch); ends after STREAM_MAX_MS and the client reconnects.
 */
export async function stream(req, res) {
  const userId = req.auth.user.id;
  const reader = { lang: req.validatedQuery.lang, timeZone: req.validatedQuery.tz };
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const unsubscribe = realtime.subscribe(userId, async (event) => {
    try {
      if (event.type === 'notification') {
        const item = await service.presentOwned(userId, event.id, reader);
        if (item) send('notification', { item, ...(await service.unreadCount(req.auth)) });
      } else if (event.type === 'sync') {
        send('sync', { unreadCount: event.unreadCount });
      }
    } catch {
      /* the next event or the reconnect resynchronises */
    }
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  const lifetime = setTimeout(() => res.end(), STREAM_MAX_MS);
  const close = () => {
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    unsubscribe();
  };
  req.on('close', close);
  res.on('close', close);
  send('ready', await service.unreadCount(req.auth));
}
