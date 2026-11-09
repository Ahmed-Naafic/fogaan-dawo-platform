/**
 * SMS adapter registry (baseline: "SMS is simulated … write SMS messages to an in-app outbox … behind a
 * clean adapter interface"). Today the only provider is SIMULATED: it never contacts a network and
 * reports the message as delivered. A real gateway later implements the same `send` interface and is
 * selected here; services only call `getSmsProvider()`.
 *
 * Interface: send({ to, message }) → Promise<{ status: 'SENT' | 'FAILED', providerReference, error? }>.
 */
import { randomUUID } from 'node:crypto';

const simulated = Object.freeze({
  code: 'SIMULATED',
  simulated: true,
  async send({ to, message }) {
    if (!message) return { status: 'FAILED', providerReference: null, error: 'Empty message' };
    return { status: 'SENT', providerReference: `SMS-DEMO-${randomUUID().slice(0, 8).toUpperCase()}`, to };
  },
});

/** The SMS adapter in use (SIMULATED today). Interface: send({ to, message }) → { status, providerReference, error? }. */
export function getSmsProvider() {
  return simulated;
}
