import { prisma } from '../../config/database.js';
import { qualifiedTable } from '../../utils/sql.js';
import { withTransaction } from '../../utils/transaction.js';
import { notify } from './notification.service.js';

/**
 * Appointment reminders: 24 h, 1 h and 10 min before a CONFIRMED appointment, for the patient and the
 * doctor. Durable: each reminder is a row (appointment_reminders, UTC due time) so restarts lose
 * nothing, and the sweep is safe to run on several instances (FOR UPDATE SKIP LOCKED).
 *
 * One sweep (every minute):
 *  1. plan    — create missing reminder rows for CONFIRMED appointments starting within the next 25 h
 *               (a rescheduled appointment is a new appointment, so it simply gets its own rows);
 *  2. cancel  — mark PENDING reminders of appointments that are no longer CONFIRMED as CANCELLED;
 *  3. send    — for each due reminder, re-check the appointment *right before sending*; send only if it is
 *               still CONFIRMED, still in the future, and the reminder isn't stale (missed while down).
 * Duplicates are impossible: unique (appointment, user, kind) for rows, and a unique event key for the
 * notification itself.
 */
export const REMINDERS = Object.freeze([
  { kind: 'BEFORE_24H', minutesBefore: 24 * 60, graceMinutes: 180 },
  { kind: 'BEFORE_1H', minutesBefore: 60, graceMinutes: 20 },
  { kind: 'BEFORE_10M', minutesBefore: 10, graceMinutes: 7 },
]);
const PLAN_HORIZON_MS = 25 * 3_600_000;
const byKind = Object.fromEntries(REMINDERS.map((r) => [r.kind, r]));

/** When a reminder of a kind (24 h, 1 h, 10 min before) is due for an appointment start. */
export const reminderDueAt = (startAtUtc, kind) => new Date(new Date(startAtUtc).getTime() - byKind[kind].minutesBefore * 60_000);

/** Creates the reminder rows for a confirmed appointment (skipping ones already past). */
export async function planReminders(now = new Date(), client = prisma) {
  const appointments = await client.appointment.findMany({
    where: { status: 'CONFIRMED', startAtUtc: { gt: now, lte: new Date(now.getTime() + PLAN_HORIZON_MS) } },
    select: { id: true, startAtUtc: true, patient: { select: { userId: true } }, doctor: { select: { userId: true } } },
  });
  const rows = appointments.flatMap((a) =>
    [a.patient.userId, a.doctor.userId].flatMap((userId) => REMINDERS.map(({ kind }) => ({ appointmentId: a.id, userId, kind, dueAt: reminderDueAt(a.startAtUtc, kind) }))),
  );
  if (!rows.length) return 0;
  return (await client.appointmentReminder.createMany({ data: rows, skipDuplicates: true })).count;
}

/** Called inside cancellation / reschedule transactions too, so reminders stop immediately. */
export const cancelRemindersForAppointment = (tx, appointmentId) =>
  tx.appointmentReminder.updateMany({ where: { appointmentId, status: 'PENDING' }, data: { status: 'CANCELLED' } });

/** Cancels pending reminders of appointments that are no longer confirmed. */
export const cancelStaleReminders = (client = prisma) =>
  client.appointmentReminder.updateMany({ where: { status: 'PENDING', appointment: { status: { not: 'CONFIRMED' } } }, data: { status: 'CANCELLED' } });

/** Sends due reminders (each in its own short transaction). Returns { sent, cancelled, skipped }. */
export async function dispatchDueReminders(now = new Date(), { limit = 100 } = {}) {
  const result = { sent: 0, cancelled: 0, skipped: 0 };
  for (let i = 0; i < limit; i += 1) {
    const outcome = await withTransaction(async (tx) => {
      const [due] = await tx.$queryRawUnsafe(
        `SELECT id FROM ${qualifiedTable('appointment_reminders')} WHERE status = 'PENDING' AND due_at <= $1 ORDER BY due_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
        now,
      );
      if (!due) return null;
      const reminder = await tx.appointmentReminder.findUnique({
        where: { id: due.id },
        include: {
          user: { select: { notificationPreference: true } },
          appointment: { select: { id: true, status: true, startAtUtc: true, patient: { select: { userId: true, user: { select: { fullName: true } } } }, doctor: { select: { userId: true, user: { select: { fullName: true } } } } } },
        },
      });
      const { appointment } = reminder;
      const finish = (status) => tx.appointmentReminder.update({ where: { id: reminder.id }, data: { status, ...(status === 'SENT' ? { sentAt: now } : {}) } }).then(() => status);

      // Re-check everything at send time.
      if (appointment.status !== 'CONFIRMED') return finish('CANCELLED');
      if (appointment.startAtUtc <= now) return finish('SKIPPED');
      if (now.getTime() - reminder.dueAt.getTime() > byKind[reminder.kind].graceMinutes * 60_000) return finish('SKIPPED'); // missed (e.g. API was down)
      if (reminder.user.notificationPreference?.remindersEnabled === false) return finish('SKIPPED');

      const isDoctor = reminder.userId === appointment.doctor.userId;
      await notify(tx, {
        kind: 'appointment.reminder',
        recipients: [{ userId: reminder.userId, role: isDoctor ? 'DOCTOR' : 'PATIENT' }],
        params: {
          reminder: reminder.kind,
          appointmentId: appointment.id,
          startAtUtc: appointment.startAtUtc.toISOString(),
          counterpart: isDoctor ? appointment.patient.user.fullName : appointment.doctor.user.fullName,
        },
        eventKey: `reminder.${reminder.kind}:${appointment.id}`,
      });
      return finish('SENT');
    });
    if (!outcome) break;
    if (outcome === 'SENT') result.sent += 1;
    else if (outcome === 'CANCELLED') result.cancelled += 1;
    else result.skipped += 1;
  }
  return result;
}

/** Background job: plans, cancels and sends due reminders (claims rows with SKIP LOCKED, safe to overlap). */
export async function runReminderSweep(now = new Date()) {
  const planned = await planReminders(now);
  const { count: cancelled } = await cancelStaleReminders();
  const dispatched = await dispatchDueReminders(now);
  return { planned, cancelledStale: cancelled, ...dispatched };
}
