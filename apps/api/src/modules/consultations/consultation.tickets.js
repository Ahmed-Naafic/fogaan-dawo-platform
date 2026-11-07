import { createHash, randomBytes } from 'node:crypto';
import { SIGNAL_TICKET_TTL_SECONDS } from './consultation.constants.js';

/**
 * Signaling tickets: 256-bit random values handed to an authorised participant by POST …/join and
 * presented as the FIRST WebSocket message (never in a URL). Each ticket is bound to one user, one
 * role and one consultation, expires after ~60 s and can be used once. Only a SHA-256 hash is kept,
 * in this process's memory (the signaling hub runs in the same process; a multi-instance deployment
 * needs a shared store such as Redis, like the notification stream).
 */
const tickets = new Map(); // hash -> { userId, role, consultationId, expiresAt }
const hash = (ticket) => createHash('sha256').update(ticket).digest('base64url');

function sweep(now) {
  for (const [key, t] of tickets) if (t.expiresAt <= now) tickets.delete(key);
}

export function issueTicket({ userId, role, consultationId }, now = Date.now(), ttlSeconds = SIGNAL_TICKET_TTL_SECONDS) {
  sweep(now);
  const ticket = randomBytes(32).toString('base64url');
  tickets.set(hash(ticket), { userId, role, consultationId, expiresAt: now + ttlSeconds * 1000 });
  return { ticket, expiresAt: new Date(now + ttlSeconds * 1000) };
}

/**
 * Consumes a ticket: returns its binding or null (unknown, expired or already used). The ticket is
 * deleted whether or not it was still valid, so it can never be replayed.
 */
export function consumeTicket(ticket, now = Date.now()) {
  if (typeof ticket !== 'string' || ticket.length < 20 || ticket.length > 100) return null;
  const key = hash(ticket);
  const binding = tickets.get(key);
  tickets.delete(key);
  if (!binding || binding.expiresAt <= now) return null;
  return { userId: binding.userId, role: binding.role, consultationId: binding.consultationId };
}

/** Tests only. */
export const __ticketCount = () => tickets.size;
