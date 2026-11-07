import { createApp } from './app.js';
import { getAuthConfig } from './config/auth.js';
import { disconnectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { googleConfigProblem } from './config/google.js';
import { pushConfigProblem } from './config/push.js';
import { webrtcConfigProblem } from './config/webrtc.js';
import { attachSignaling, closeSignaling } from './modules/consultations/consultation.signaling.js';

// Fail fast on missing/weak auth configuration instead of on the first login.
try {
  getAuthConfig();
} catch (error) {
  console.error(`[api] configuration error: ${error.message}`);
  process.exit(1);
}

const server = createApp().listen(env.port, () => {
  console.log(`[api] listening on http://localhost:${env.port} (${env.nodeEnv})`);
  const googleProblem = googleConfigProblem(); // names variables only, never their values
  console.log(`[api] Google sign-in ${googleProblem ? `disabled: ${googleProblem}` : 'enabled'}`);
  const pushProblem = pushConfigProblem();
  console.log(`[api] Web Push ${pushProblem ? `disabled: ${pushProblem}` : 'enabled'}`);
  const rtcProblem = webrtcConfigProblem();
  console.log(`[api] Video consultations: STUN only (no TURN)${rtcProblem ? ` — ${rtcProblem}` : ''}`);
});
// WebRTC signaling (WebSocket) on the same HTTP server: /api/v1/consultations/signal
attachSignaling(server);

// Releases unpaid reservations once their payment window has passed (10 min standard, 48 h follow-up).
// expireStaleHolds locks rows with SKIP LOCKED, so several API instances can run it safely.
// HOLD_SWEEP_INTERVAL_SECONDS=0 disables it (e.g. when a separate worker runs the sweep).
const sweepSeconds = Number.parseInt(process.env.HOLD_SWEEP_INTERVAL_SECONDS ?? '60', 10);
let sweep = null;
if (sweepSeconds > 0) {
  const { expireStaleHolds } = await import('./modules/appointments/appointment.service.js');
  sweep = setInterval(() => {
    expireStaleHolds().catch((error) => console.error(`[api] hold sweep failed: ${error.code ?? error.name}`));
  }, sweepSeconds * 1000);
  sweep.unref();
}

// Notifications: the dispatcher delivers new notifications (real-time stream + Web Push) every few
// seconds; the reminder sweep plans/cancels/sends appointment reminders every minute. Both claim rows
// with SKIP LOCKED, so several instances are safe. Set either interval to 0 to disable it.
const loops = [];
const every = (seconds, task, label) => {
  if (!(seconds > 0)) return;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    task()
      .catch((error) => console.error(`[api] ${label} failed: ${error.code ?? error.name}`))
      .finally(() => {
        running = false;
      });
  }, seconds * 1000);
  timer.unref();
  loops.push(timer);
};
{
  const { dispatchPendingNotifications } = await import('./modules/notifications/notification.service.js');
  const { runReminderSweep } = await import('./modules/notifications/reminder.service.js');
  every(Number.parseInt(process.env.NOTIFICATION_DISPATCH_INTERVAL_SECONDS ?? '3', 10), () => dispatchPendingNotifications(), 'notification dispatch');
  every(Number.parseInt(process.env.REMINDER_SWEEP_INTERVAL_SECONDS ?? '60', 10), () => runReminderSweep(), 'reminder sweep');
}

const shutdown = (signal) => {
  console.log(`[api] ${signal} received, closing`);
  if (sweep) clearInterval(sweep);
  loops.forEach(clearInterval);
  closeSignaling();
  server.close(() => disconnectDatabase().finally(() => process.exit(0)));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
