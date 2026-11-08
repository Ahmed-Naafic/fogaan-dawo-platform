import { prisma } from '../../config/database.js';
import { getSmsProvider } from '../../adapters/sms/index.js';

/**
 * In-app SMS outbox (baseline requirement). Important events also produce a short SMS text, written to
 * sms_outbox through the SMS adapter (simulated: nothing leaves the server). Each user can read their own
 * outbox; administrators can read all of it. Texts are rendered in the recipient's language and zone.
 */

/** Notification kinds that also send an SMS (bookings, payments, cancellations, refunds, reminders, follow-ups). */
export const SMS_KINDS = Object.freeze(
  new Set(['payment.confirmed', 'appointment.cancelled', 'appointment.rescheduled', 'refund.completed', 'appointment.reminder', 'followup.proposed', 'followup.confirmed', 'consultation.admitted', 'prescription.issued']),
);
const MAX_SMS = 320;

export const isSmsKind = (kind) => SMS_KINDS.has(kind) || [...SMS_KINDS].some((k) => kind.startsWith(`${k}.`));

/** Writes one SMS per recipient inside the caller's transaction. `messages`: [{ userId, phone, text }]. */
export async function queueSms(tx, messages) {
  const provider = getSmsProvider();
  for (const m of messages) {
    const text = `Fogaan Dawo: ${m.text}`.slice(0, MAX_SMS);
    const result = await provider.send({ to: m.phone, message: text });
    await tx.smsOutbox.create({
      data: {
        userId: m.userId,
        recipient: (m.phone ?? 'in-app').slice(0, 32),
        message: text,
        provider: provider.code,
        status: result.status,
        attempts: 1,
        lastError: result.error ?? null,
        sentAt: result.status === 'SENT' ? new Date() : null,
      },
    });
  }
}

const present = (r) => ({ id: r.id, recipient: r.recipient, message: r.message, status: r.status, provider: r.provider, sentAt: r.sentAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() });

/** GET /api/v1/notifications/sms — the signed-in user's own outbox (newest first). */
export async function listMySms(auth, { page = 1, pageSize = 20 } = {}) {
  const where = { userId: auth.user.id };
  const [rows, total] = await Promise.all([prisma.smsOutbox.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }), prisma.smsOutbox.count({ where })]);
  return { simulated: true, items: rows.map(present), total, page, pageSize };
}

/** GET /api/v1/admin/sms-outbox?q= — every simulated SMS (ADMIN), newest first; q matches number or text. */
export async function listAllSms({ q, page = 1, pageSize = 30 } = {}) {
  const where = q ? { OR: [{ recipient: { contains: q } }, { message: { contains: q, mode: 'insensitive' } }] } : {};
  const [rows, total] = await Promise.all([
    prisma.smsOutbox.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { user: { select: { fullName: true } } } }),
    prisma.smsOutbox.count({ where }),
  ]);
  return { simulated: true, items: rows.map((r) => ({ ...present(r), user: r.user?.fullName ?? null })), total, page, pageSize };
}
