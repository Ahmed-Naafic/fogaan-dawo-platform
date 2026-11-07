import { WebSocketServer } from 'ws';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import * as repo from './consultation.repository.js';
import { consumeTicket } from './consultation.tickets.js';

/**
 * WebRTC signaling over a dedicated WebSocket endpoint (one consultation = one room, at most one
 * patient and one assigned doctor). Security model:
 *  - the URL carries nothing: the first message must be { type: 'auth', ticket } within 5 s; the
 *    ticket is single-use, ~60 s, bound to user + role + consultation (POST …/join issues it);
 *  - the bound user must still be that consultation's patient / doctor, and the call must not be over;
 *  - browser Origin must be in the CORS allow-list (cross-site WebSocket hijacking);
 *  - every message is size-limited (64 KB frames), rate-limited and validated; only offer / answer /
 *    ICE candidate / media-state / ICE-restart messages are relayed, rebuilt from validated fields only,
 *    and only once the doctor has admitted the patient (IN_PROGRESS). Offers come from the doctor,
 *    answers and restart requests from the patient.
 *  - SDP and candidates are never logged or stored.
 * State changes (admit, reject, leave, end) are made over HTTP; the hub only tells clients to refresh.
 * In-process: a multi-instance deployment needs sticky sessions or a shared pub/sub.
 */

export const SIGNAL_PATH = '/api/v1/consultations/signal';
const MAX_FRAME_BYTES = 64 * 1024;
const MAX_SDP = 32 * 1024;
const MAX_CANDIDATE = 2048;
const AUTH_TIMEOUT_MS = 5000;
const HEARTBEAT_MS = 20_000;
const RATE = { capacity: 120, refillPerSecond: 12 };

export const CloseCode = Object.freeze({ AUTH_FAILED: 4001, FORBIDDEN: 4003, RATE_LIMITED: 4008, REPLACED: 4009, ENDED: 4010, INVALID: 4400 });

const rooms = new Map(); // consultationId -> { status, sockets: { PATIENT, DOCTOR }, dropped: Set<role> }
let wss = null;
let heartbeat = null;

const peerOf = (role) => (role === 'DOCTOR' ? 'PATIENT' : 'DOCTOR');
const send = (ws, msg) => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
};
const room = (id) => {
  if (!rooms.has(id)) rooms.set(id, { status: null, sockets: { PATIENT: null, DOCTOR: null }, dropped: new Set() });
  return rooms.get(id);
};

/* ------------------------------------------------------------ validation */

const SESSION = /^[A-Za-z0-9_-]{8,64}$/;
const isNullableString = (v, max) => v === null || v === undefined || (typeof v === 'string' && v.length <= max);
const isNullableIndex = (v) => v === null || v === undefined || (Number.isInteger(v) && v >= 0 && v <= 64);

/** Validates one client message; returns the sanitized message to relay/handle, or null. */
export function validateSignal(raw) {
  let msg;
  try {
    msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return null;
  switch (msg.type) {
    case 'auth':
      return typeof msg.ticket === 'string' && msg.ticket.length <= 100 ? { type: 'auth', ticket: msg.ticket } : null;
    case 'offer':
    case 'answer':
      if (typeof msg.sdp !== 'string' || msg.sdp.length > MAX_SDP || !msg.sdp.startsWith('v=0') || !SESSION.test(msg.session ?? '')) return null;
      return { type: msg.type, sdp: msg.sdp, session: msg.session };
    case 'candidate':
      if (!SESSION.test(msg.session ?? '') || typeof msg.candidate !== 'string' || msg.candidate.length > MAX_CANDIDATE) return null;
      if (msg.candidate && !msg.candidate.startsWith('candidate:')) return null;
      if (!isNullableString(msg.sdpMid, 64) || !isNullableIndex(msg.sdpMLineIndex)) return null;
      return { type: 'candidate', session: msg.session, candidate: msg.candidate, sdpMid: msg.sdpMid ?? null, sdpMLineIndex: msg.sdpMLineIndex ?? null };
    case 'media':
      return typeof msg.audio === 'boolean' && typeof msg.video === 'boolean' ? { type: 'media', audio: msg.audio, video: msg.video } : null;
    case 'restart':
      return { type: 'restart' };
    case 'ping':
      return { type: 'ping' };
    default:
      return null;
  }
}

/** Which role may send which relayed message type. */
const SENDERS = Object.freeze({ offer: ['DOCTOR'], answer: ['PATIENT'], candidate: ['DOCTOR', 'PATIENT'], media: ['DOCTOR', 'PATIENT'], restart: ['PATIENT'] });

/* ------------------------------------------------------------ room events */

async function recordEvent(consultationId, eventType, participantRole) {
  try {
    await repo.addEvent(prisma, { consultationId, eventType, participantRole });
  } catch (error) {
    console.error(`[api] consultation event not recorded: ${error.code ?? error.name}`);
  }
}

function broadcastPresence(id) {
  const r = rooms.get(id);
  if (!r) return;
  const presence = { type: 'presence', patient: Boolean(r.sockets.PATIENT), doctor: Boolean(r.sockets.DOCTOR) };
  send(r.sockets.PATIENT, presence);
  send(r.sockets.DOCTOR, presence);
}

/** Asks the doctor (the offerer) to start a fresh negotiation when both sides are present in a live call. */
function maybeNegotiate(id) {
  const r = rooms.get(id);
  if (r?.status === 'IN_PROGRESS' && r.sockets.PATIENT && r.sockets.DOCTOR) send(r.sockets.DOCTOR, { type: 'negotiate' });
}

/** Current presence in a consultation room (shown to participants). */
export function presence(consultationId) {
  const r = rooms.get(consultationId);
  return { patient: Boolean(r?.sockets.PATIENT), doctor: Boolean(r?.sockets.DOCTOR) };
}

/** Called after a committed state change: refresh the cached status and tell both sides to reload. */
export function stateChanged(consultationId) {
  const r = rooms.get(consultationId);
  if (!r) return;
  repo
    .findSignalingContext(prisma, consultationId)
    .then((ctx) => {
      const before = r.status;
      r.status = ctx?.status ?? null;
      for (const ws of Object.values(r.sockets)) send(ws, { type: 'state-changed' });
      if (r.status === 'COMPLETED' || r.status === 'CANCELLED') {
        for (const ws of Object.values(r.sockets)) ws?.close(CloseCode.ENDED, 'Consultation ended');
      } else if (before !== 'IN_PROGRESS' && r.status === 'IN_PROGRESS') {
        maybeNegotiate(consultationId);
      }
    })
    .catch((error) => console.error(`[api] signaling refresh failed: ${error.code ?? error.name}`));
}

/** Closes a participant's socket after an intentional leave (not counted as a network drop). */
export function disconnect(consultationId, role) {
  const ws = rooms.get(consultationId)?.sockets[role];
  if (ws) {
    ws.intentional = true;
    ws.close(1000, 'Left the consultation');
  }
}

/* ------------------------------------------------------------ connections */

function rateOk(ws) {
  const now = Date.now();
  const b = ws.bucket;
  b.tokens = Math.min(RATE.capacity, b.tokens + ((now - b.at) / 1000) * RATE.refillPerSecond);
  b.at = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

async function authenticate(ws, ticket) {
  const binding = consumeTicket(ticket);
  if (!binding) return ws.close(CloseCode.AUTH_FAILED, 'Invalid or expired ticket');
  const ctx = await repo.findSignalingContext(prisma, binding.consultationId);
  const expectedUser = binding.role === 'DOCTOR' ? ctx?.doctor.userId : ctx?.patient.userId;
  if (!ctx || expectedUser !== binding.userId) return ws.close(CloseCode.FORBIDDEN, 'Not a participant');
  if (ctx.status === 'COMPLETED' || ctx.status === 'CANCELLED') return ws.close(CloseCode.ENDED, 'Consultation ended');
  if (ws.readyState !== 1) return undefined;

  const r = room(ctx.id);
  r.status = ctx.status;
  const previous = r.sockets[binding.role];
  if (previous && previous !== ws) {
    previous.replaced = true;
    previous.close(CloseCode.REPLACED, 'Connected from another tab or reconnected');
  }
  Object.assign(ws, { consultationId: ctx.id, role: binding.role });
  r.sockets[binding.role] = ws;
  if (r.dropped.delete(binding.role)) void recordEvent(ctx.id, 'PARTICIPANT_RECONNECTED', binding.role);
  send(ws, { type: 'ready', role: binding.role, status: ctx.status });
  broadcastPresence(ctx.id);
  maybeNegotiate(ctx.id);
  return undefined;
}

function onMessage(ws, data, isBinary) {
  if (isBinary || !rateOk(ws)) return ws.close(isBinary ? CloseCode.INVALID : CloseCode.RATE_LIMITED, isBinary ? 'Text frames only' : 'Too many messages');
  const msg = validateSignal(data.toString('utf8'));
  if (!msg) return send(ws, { type: 'error', code: 'INVALID_MESSAGE' });

  if (!ws.role) {
    if (msg.type !== 'auth' || ws.authenticating) return ws.close(CloseCode.AUTH_FAILED, 'Authenticate first');
    ws.authenticating = true;
    clearTimeout(ws.authTimer);
    return authenticate(ws, msg.ticket).catch(() => ws.close(CloseCode.AUTH_FAILED, 'Authentication failed'));
  }
  if (msg.type === 'auth') return send(ws, { type: 'error', code: 'ALREADY_AUTHENTICATED' });
  if (msg.type === 'ping') return send(ws, { type: 'pong' });

  const r = rooms.get(ws.consultationId);
  if (!SENDERS[msg.type]?.includes(ws.role)) return send(ws, { type: 'error', code: 'NOT_ALLOWED' });
  if (r?.status !== 'IN_PROGRESS') return send(ws, { type: 'error', code: 'NOT_ADMITTED' });
  const peer = r.sockets[peerOf(ws.role)];
  if (!peer) return send(ws, { type: 'error', code: 'PEER_ABSENT' });
  return send(peer, msg);
}

function onClose(ws) {
  clearTimeout(ws.authTimer);
  if (!ws.role || ws.replaced) return;
  const r = rooms.get(ws.consultationId);
  if (!r || r.sockets[ws.role] !== ws) return;
  r.sockets[ws.role] = null;
  if (!ws.intentional && (r.status === 'WAITING' || r.status === 'IN_PROGRESS')) {
    r.dropped.add(ws.role);
    void recordEvent(ws.consultationId, 'PARTICIPANT_DISCONNECTED', ws.role);
  }
  broadcastPresence(ws.consultationId);
  if (!r.sockets.PATIENT && !r.sockets.DOCTOR && r.dropped.size === 0) rooms.delete(ws.consultationId);
}

function onConnection(ws) {
  ws.isAlive = true;
  ws.bucket = { tokens: RATE.capacity, at: Date.now() };
  ws.authTimer = setTimeout(() => ws.close(CloseCode.AUTH_FAILED, 'Authentication timeout'), AUTH_TIMEOUT_MS);
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  ws.on('message', (data, isBinary) => onMessage(ws, data, isBinary));
  ws.on('close', () => onClose(ws));
  ws.on('error', () => {});
}

/**
 * Attaches the signaling endpoint to an HTTP server. Other upgrade paths are refused.
 * `allowedOrigins`: browser origins allowed to connect (defaults to CORS_ORIGIN); requests without an
 * Origin header (native apps, tests) are allowed — the ticket is what authorises a connection.
 */
export function attachSignaling(server, { allowedOrigins = env.corsOrigins } = {}) {
  const allowed = new Set(allowedOrigins);
  if (!wss) {
    wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES, perMessageDeflate: false });
    wss.on('connection', onConnection);
    heartbeat = setInterval(() => {
      for (const ws of wss.clients) {
        if (!ws.isAlive) {
          ws.terminate();
          continue;
        }
        ws.isAlive = false;
        ws.ping();
      }
    }, HEARTBEAT_MS);
    heartbeat.unref();
  }
  server.on('upgrade', (req, socket, head) => {
    const reject = (status, text) => {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    const [path, query] = (req.url ?? '').split('?');
    if (path !== SIGNAL_PATH) return reject(404, 'Not Found');
    if (query !== undefined) return reject(400, 'Bad Request'); // nothing (no ticket or token) is accepted in the URL
    const origin = req.headers.origin;
    if (origin && !allowed.has(origin)) return reject(403, 'Forbidden');
    return wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  return wss;
}

/** Closes every signaling connection (shutdown / tests). */
export function closeSignaling() {
  if (!wss) return;
  for (const ws of wss.clients) ws.terminate();
  clearInterval(heartbeat);
  wss.close();
  wss = null;
  rooms.clear();
}
