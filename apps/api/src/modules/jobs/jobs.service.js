import { expireStaleHolds } from '../appointments/appointment.service.js';
import { dispatchPendingNotifications } from '../notifications/notification.service.js';
import { runReminderSweep } from '../notifications/reminder.service.js';

/**
 * Scheduled jobs, runnable on demand (serverless: an external scheduler calls them over HTTP).
 * They are the same functions src/server.js runs on intervals. Each one claims rows with
 * FOR UPDATE SKIP LOCKED, so an HTTP run overlapping another run or a long-lived server is safe.
 */
const MAX_DISPATCH_BATCHES = 10; // 10 × 50 notifications per run; the rest waits for the next run

async function dispatchNotifications() {
  let delivered = 0;
  for (let i = 0; i < MAX_DISPATCH_BATCHES; i += 1) {
    const n = await dispatchPendingNotifications();
    delivered += n;
    if (n === 0) break;
  }
  return { delivered };
}

export const JOBS = Object.freeze({
  'expire-holds': async () => ({ expired: await expireStaleHolds() }),
  reminders: () => runReminderSweep(),
  notifications: dispatchNotifications,
});

/** Runs the named jobs one after another; one failing job does not stop the others. */
export async function runJobs(names) {
  const results = {};
  let ok = true;
  for (const name of names) {
    const started = Date.now();
    try {
      results[name] = { ok: true, ...(await JOBS[name]()), ms: Date.now() - started };
    } catch (error) {
      ok = false;
      // Database errors can carry row data: log class + code only.
      console.error(`[api] job ${name} failed: ${error.code ?? error.name}`);
      results[name] = { ok: false, ms: Date.now() - started };
    }
  }
  return { ok, results };
}
