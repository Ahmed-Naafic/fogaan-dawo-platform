# Vercel serverless compatibility — realtime and scheduled work (inspection only)

Status: **documentation only — nothing in these systems was changed.** Decision needed before production.

## What runs today (one long-lived Node process: `apps/api/src/server.js`)

| System | How it works today | File |
|---|---|---|
| Video-call signalling | WebSocket server (`ws`) attached to the HTTP server at `/api/v1/consultations/signal`; rooms, presence and relayed SDP/ICE live in process memory | `modules/consultations/consultation.signaling.js` |
| Live notifications | Server-Sent Events at `/api/v1/notifications/stream` (25 s heartbeat); fan-out through an in-process `EventEmitter` | `modules/notifications/notification.controller.js`, `notification.realtime.js` |
| Scheduled work | `setInterval` loops: unpaid-hold expiry (60 s), notification/push dispatch, appointment-reminder sweep (60 s) | `server.js` |

## Why these break on Vercel Functions

- **No WebSocket server.** Vercel Functions answer HTTP requests; they cannot accept WebSocket upgrades. Signalling would fail immediately → **video consultations would not connect**.
- **Long-lived responses are capped.** SSE works only until the function's maximum duration and costs a running function per connected user; connections drop and reconnect constantly. Instances are separate, so the in-process `EventEmitter` does not reach users connected to another instance.
- **No background timers.** Functions are frozen between requests; `setInterval` never fires reliably. Holds would not expire on time, reminders would not be sent, queued notifications would not be dispatched.
- **In-memory state is per instance** (signalling rooms, presence, notification hub) and is lost when an instance is recycled.
- Also relevant: request/response bodies are limited (~4.5 MB) — already handled for files by the Supabase staged-upload design.

## Options

### A. Vercel for the web app, a long-running host for the API (recommended — smallest change)
Deploy `apps/web` on Vercel (static/CDN). Run `apps/api` unchanged as a long-running Node service (Render, Railway, Fly.io, a VPS or a container platform) with Neon + Supabase Storage.
- **Keeps all current behaviour** (WebSocket signalling, SSE, timers) with zero code changes; also removes the 4.5 MB body limit.
- Run **one instance**, or add a shared bus before scaling out (see C).
- Trade-offs: one more platform to operate; pay for an always-on instance; need health checks and restarts.

### B. API on Vercel + a small realtime/worker service
Keep REST on Vercel Functions; move only the stateful parts to a long-running "realtime" service: WebSocket signalling + SSE + schedulers (the existing code, extracted). The web app connects to it for `/consultations/signal` and `/notifications/stream`.
- Trade-offs: two deployables; shared auth (same JWT secret) and CORS; the REST API must publish events to the realtime service (HTTP call or Postgres `LISTEN/NOTIFY` on Neon).

### C. Fully serverless with managed services
- Signalling and live notifications: **Supabase Realtime** (already the storage provider; channels/broadcast with short-lived, server-issued tokens) or a managed WebSocket service (Ably, Pusher). Requires rewriting the signalling protocol and authorisation (tickets → channel tokens) and the notification stream.
- Schedulers: **Vercel Cron Jobs** calling protected endpoints (`/internal/sweep-holds`, `/internal/send-reminders`, `/internal/dispatch-notifications`, `/internal/storage-cleanup`) — the existing functions already lock rows (`SKIP LOCKED`), so they are safe to run from cron; minimum interval depends on the Vercel plan (minute-level reminders need a paid plan).
- Trade-offs: largest rewrite; new vendor dependencies; must re-test the video flow end to end. Most "native" for Vercel.

### Scheduler-only alternatives
Vercel Cron (above), Neon + `pg_cron` calling nothing externally (SQL-only jobs only), or GitHub Actions / an external cron hitting protected endpoints (coarser timing).

## Recommendation

**Option A** for launch: it preserves every approved behaviour (video, live notifications, reminders) with no code changes, and storage is already portable (Supabase). Later, if the API must be serverless, move to **Option B** (extract the realtime/worker parts) rather than a full rewrite.

Whatever is chosen, before production: run exactly one API instance (or add a shared event bus), configure `CORS_ORIGIN` and `WEB_APP_URL` for the real domains, and schedule `npm run storage:cleanup-staging` (daily) on the long-running host or via cron.
