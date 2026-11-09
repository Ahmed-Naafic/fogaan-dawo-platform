# Deploying the API to Vercel (`fogaan-dawo-api`)

This guide covers the **backend only** (`apps/api`). It does not deploy anything by itself, and it
**never runs database migrations**. Production migrations need separate, explicit approval (see
[database.md](database.md)). The approved migration set is for development and isolated testing only.

## How it runs

| | Local / long-lived host | Vercel |
|---|---|---|
| Entry | `apps/api/src/server.js` (`app.listen`) | `apps/api/src/index.js` (`export default app`, detected by the Express preset) |
| App | `createApp()` from `src/app.js` | the same `createApp({ signalingAvailable: false })` |
| Hold expiry, reminders, notification delivery | `setInterval` loops | `/api/internal/jobs/*`, called by a scheduler |
| WebRTC signaling (WebSocket) | attached to the HTTP server | **not available** (503 `SIGNALING_UNAVAILABLE`), see below |

The Express preset deploys the whole app as one function and sends every path to it, so every existing
route (`/api/health`, `/api/v1/...`) keeps its URL. No rewrites are needed.

## Project settings (Vercel dashboard → `fogaan-dawo-api`)

| Setting | Value |
|---|---|
| Root Directory | `apps/api` |
| Include files outside the Root Directory in the Build Step | **Enabled** (the Prisma schema is at `prisma/schema.prisma` in the repo root) |
| Framework Preset | **Express** (pinned by `apps/api/vercel.json`: `"framework": "express"`). The entry is `src/index.js`. |
| Build Command | **no override** (leave the toggle off). The preset runs the package `build` script, which is `prisma generate --schema ../../prisma/schema.prisma`. |
| Output Directory | **no override** (leave the toggle off) |
| Install Command | default (Vercel detects the npm workspace from the root `package-lock.json`) |
| Node.js Version | 24.x. `engines.node` in `apps/api/package.json` (`^22.9.0 \|\| ^24.0.0`) overrides the dashboard and resolves to 24.x. |
| Fluid compute | Enabled (default for new projects) |
| Function region | the region nearest the Neon database (e.g. `iad1` for Neon `us-east-1`, `fra1` for `eu-central-1`) |

## Environment variables (names only; set values in the dashboard, never in git)

Server-side only. **None of these may use a `VITE_` prefix**, because Vite inlines `VITE_*` values into the browser bundle.

Required:

| Name | Notes |
|---|---|
| `NODE_ENV` | `production` (secure cookies, generic 5xx messages) |
| `DATABASE_URL` | Neon **pooled** connection (host contains `-pooler`), `sslmode=require`. Recommended extra parameters: `connect_timeout=15` (Neon compute wake-up) and a small `connection_limit` (e.g. `5`) |
| `DIRECT_URL` | Neon **direct** connection. Read by `prisma/schema.prisma` (`directUrl`), so `prisma generate`/validation needs it to exist. The app never migrates. |
| `DATABASE_ENV` | `production` (makes `scripts/db-guard.mjs` refuse seeds and unflagged migrations against it) |
| `JWT_ACCESS_SECRET` | at least 32 random characters |
| `CORS_ORIGIN` | the exact web origin(s), comma-separated, never `*` |
| `TRUST_PROXY` | `1` (Vercel's proxy sets the client IP; rate limiting needs it) |
| `CRON_SECRET` | at least 32 random characters; enables `/api/internal/jobs/*` |

Optional (each feature reports itself as unavailable when its values are missing):

- Google sign-in: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `WEB_APP_URL`, `OAUTH_STATE_SECRET`
- Web Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- Tuning: `JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TOKEN_TTL_SECONDS`, `REFRESH_TOKEN_TTL_DAYS`, `BCRYPT_ROUNDS`,
  `COOKIE_SECURE`, `AUTH_RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_WINDOW_MINUTES`, `UPLOAD_RATE_LIMIT_MAX`,
  `AVAILABILITY_RATE_LIMIT_MAX`, `PUBLIC_RATE_LIMIT_MAX`, `PROFILE_RATE_LIMIT_MAX`, `CONSULTATION_RATE_LIMIT_MAX`, `WEBRTC_STUN_URLS`

Not used on Vercel: `PORT`, `HOLD_SWEEP_INTERVAL_SECONDS`, `NOTIFICATION_DISPATCH_INTERVAL_SECONDS`,
`REMINDER_SWEEP_INTERVAL_SECONDS` (they only affect `src/server.js`). `STORAGE_DIR` cannot work on Vercel (see blockers).

## Health checks

- `GET /api/health`: liveness. No database access.
- `GET /api/health/ready`: readiness. Returns 200 `{ status: "ready", checks: { config, database } }` or 503
  `not_ready`. Shows check names and true/false only, never hosts or errors.

## Scheduled jobs

`src/server.js` runs three loops. On Vercel there is no long-lived process, so the same functions are
exposed as authenticated endpoints (`Authorization: Bearer <CRON_SECRET>`, GET):

| Endpoint | Job | Needed frequency |
|---|---|---|
| `/api/internal/jobs/expire-holds` | release unpaid reservations (10 min / 48 h windows) | every 1–5 min. Correctness does not depend on it: expired holds are already refused for payment, shown as expired, and can be re-booked. The sweep frees the slot in listings. |
| `/api/internal/jobs/reminders` | plan, cancel and send appointment reminders (24 h / 1 h / 10 min) | **every minute** (the 10-minute reminder has a 7-minute grace window) |
| `/api/internal/jobs/notifications` | deliver pending notifications (Web Push) | every minute (was every 3 s locally) |
| `/api/internal/jobs/tick` | all three, in that order | every minute |

All jobs claim rows with `FOR UPDATE SKIP LOCKED`, so overlapping runs are safe.

**Recommended schedule:**

- **Vercel Pro:** add a per-minute Vercel Cron and set `CRON_SECRET` (Vercel sends it as the Bearer token):
  ```json
  "crons": [{ "path": "/api/internal/jobs/tick", "schedule": "* * * * *" }]
  ```
  This is **not** in `vercel.json` by default, because on Hobby a schedule more frequent than once a day
  fails the deployment.
- **Hobby:** Vercel Cron runs at most once per day (±59 min), which is not enough for reminders. Use an
  external scheduler that can send the Bearer header every minute (e.g. Upstash QStash schedules or a
  monitoring/cron service).

Notification delivery latency rises from ~3 s to up to ~1 min. In-app notifications are still written
immediately, and the web client's 60-second unread-count poll picks them up.

## Functionality that needs separate infrastructure

1. **Private file storage (blocker).** `adapters/storage/privateStorage.js` writes to local disk. On Vercel the
   filesystem is read-only apart from an ephemeral `/tmp`. Doctor application documents, verification files,
   medical documents, prescriptions' PDFs, profile photos and medical-history attachments will fail or be lost. The adapter
   must be swapped for private object storage (Vercel Blob with private access, S3, R2 or GCS) before these features go live. Callers only use
   `put`/`get`/`remove`, so the change is confined to the adapter.
2. **Video consultation signaling (blocker for video).** Vercel Functions do support WebSockets, but
   new connections are *not* guaranteed to reach the same instance. The hub keeps rooms and single-use join
   tickets in process memory, and `POST …/join`/admit/end (HTTP) notify the hub in-process. On Vercel the patient, doctor and
   ticket issuer can land on different instances, so calls would fail intermittently. The function
   therefore does not start the hub. Options:
   - **A (no code change):** run `src/server.js` as a **single** long-lived instance (Render, Fly.io, Railway, a VM)
     and point consultation traffic (`/api/v1/consultations/*`, HTTP and WebSocket) at it. This needs a small web-client change
     (a separate base URL for consultations) and that host's origin in its `CORS_ORIGIN`.
   - **B (code change):** move tickets, room presence and state-change fan-out to Redis (pub/sub), then attach
     the hub to an exported `http.Server` on Vercel.
   STUN-only WebRTC also still needs a TURN service for strict NATs.
3. **Real-time notification stream (degraded, not broken).** `/api/v1/notifications/stream` (SSE) works, but
   events are published in-process: a job running in another instance cannot reach a stream held open elsewhere. Streams
   are also cut at the function's max duration (300 s by default; the server closes them at 10 min). The client reconnects
   and its 60-second poll keeps counts correct. A shared bus (Postgres LISTEN/NOTIFY or Redis) is needed for instant delivery.
4. **Rate limiting (weakened).** `express-rate-limit` uses an in-memory store, so limits are per instance. A shared
   store (e.g. Redis) is needed for strict global limits, or use Vercel Firewall rate-limit rules in front.

## Web app ↔ API origin (cookie)

The refresh token is an HTTP-only `SameSite=Strict` cookie scoped to `/api/v1/auth`. `*.vercel.app` is a
public suffix, so `fogaan-dawo.vercel.app` and `fogaan-dawo-api.vercel.app` are **different sites**, and the
browser will not send the cookie cross-site. Sessions would then end after 15 minutes. Keep the API same-origin
with the web app:

- in the **web** project, rewrite `/api/:path*` to `https://<api-domain>/api/:path*` and keep `VITE_API_URL=/api`, or
- serve both from one registrable domain (e.g. `app.example.com` and `api.example.com`).

`GOOGLE_REDIRECT_URI` is on the web origin (`https://<web-domain>/api/v1/auth/google/callback`), so it also relies on the `/api` rewrite.

## Pre-deployment checklist

- [ ] All required variables set for Production (and Preview, pointing at a **non-production** Neon branch)
- [ ] `GET /api/health/ready` returns 200 on a preview deployment
- [ ] Database schema already matches (migrations are applied separately, only with explicit approval)
- [ ] Scheduler configured and `GET /api/internal/jobs/tick` returns 200 with the Bearer secret
- [ ] Storage adapter replaced before enabling uploads; video consultations routed to a long-lived host
