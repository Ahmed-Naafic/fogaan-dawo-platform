# API

- **Base URL:** `http://localhost:$PORT` (default `PORT` is 4000; the current `.env` sets 5000). In development the web app calls `/api/...` and Vite proxies it.
- **Versioning:** feature endpoints live under `/api/v1`. `/api/health` is unversioned.
- **Format:** JSON request and response bodies. Successful responses are `{ "data": ... }`.
- **Errors:** every error is `{ "error": { "code": string, "message": string, "details"?: any } }`, where `code` is stable and machine-readable. Validation errors (`400 VALIDATION_ERROR`) list `details: [{ path, message }]`; submitted values are never echoed back.
- **Auth:** send `Authorization: Bearer <accessToken>`. See [auth.md](auth.md) for the full design.
- **Client header:** `X-Fogaan-Client: web | native`. It is required on `/auth/refresh` and `/auth/logout` (CSRF protection), and `native` changes how refresh tokens are delivered.

## Health

### `GET /api/health`
`200` → `{ "status": "ok", "service": "fogaan-dawo-api", "uptimeSeconds": 12, "timestamp": "…" }` (liveness, no database access)

### `GET /api/health/ready`
Readiness: auth configuration is valid and the database answers within 5 s.
`200` → `{ "status": "ready", "checks": { "config": true, "database": true }, "timestamp": "…" }`; otherwise `503` with `"status": "not_ready"`. Only check names and booleans are returned.

## Scheduled jobs (`/api/internal/jobs`)

These are for a scheduler (Vercel Cron or an external one), not for clients. Every request needs `Authorization: Bearer <CRON_SECRET>`. If `CRON_SECRET` is unset or shorter than 32 characters, they return `503 JOBS_DISABLED`. Wrong credentials return `401`.

- `GET /api/internal/jobs/tick` runs expire-holds, reminders and notifications, in that order.
- `GET /api/internal/jobs/expire-holds`, `/reminders` and `/notifications` each run one job.

The response is `200` (or `500` if any job failed): `{ "ok": true, "results": { "<job>": { "ok": true, …counts, "ms": 120 } } }`. See [deployment-vercel.md](deployment-vercel.md).

### Video signaling on serverless
On the Vercel deployment, `/api/v1/consultations/signal` returns `503 SIGNALING_UNAVAILABLE`, because the WebSocket hub runs only in `src/server.js`.

## Authentication (`/api/v1/auth`)

### Common: the auth result

`register`, `login`, `refresh` and `switch-role` all return:

```json
{
  "data": {
    "accessToken": "eyJ…",
    "tokenType": "Bearer",
    "expiresIn": 900,
    "user": { "id": "…", "fullName": "Amina Cabdi", "email": "amina@example.com", "phone": "+252615550101",
              "status": "ACTIVE", "preferredLanguage": "so", "timeZone": "Africa/Mogadishu",
              "emailVerifiedAt": null, "phoneVerifiedAt": null, "lastLoginAt": "…", "createdAt": "…" },
    "roles": ["PATIENT"],
    "activeRole": "PATIENT",
    "profiles": { "patient": { "id": "…" }, "doctor": null },
    "session": { "id": "…", "expiresAt": "…" },
    "refreshTokenExpiresAt": "…"
  }
}
```

How the refresh token is delivered:

- **Web clients** (no header, or `X-Fogaan-Client: web`) receive it **only** in the `fd_refresh` cookie: `HttpOnly; SameSite=Strict; Path=/api/v1/auth`, plus `Secure` in production. It is never in the response body.
- **Native clients** (`X-Fogaan-Client: native`) receive `"refreshToken": "v1.…"` in the body and must keep it in secure storage.

Password hashes are never returned.

### `POST /api/v1/auth/register`
Creates a **patient** account (user + PATIENT role + patient profile) in one transaction, then signs the user in. It cannot create doctors or admins; unknown fields such as `role` are rejected.

| Field | Rules |
|---|---|
| `fullName` | required, 2–160 characters |
| `email` | optional; trimmed and lower-cased; must be valid |
| `phone` | optional; international format, normalised to E.164 (`00252 61 555 0101` → `+252615550101`). Local numbers without a country code are rejected. |
| `password` | 8 to 72 bytes, at least one letter and one number |
| `passwordConfirmation` | must equal `password` |
| `preferredLanguage` | optional, `en` or `so` |

At least one of `email` or `phone` is required.

| Status | Meaning |
|---|---|
| `201` | Created; returns the auth result |
| `400` | `VALIDATION_ERROR` |
| `409` | `EMAIL_TAKEN` or `PHONE_TAKEN` |
| `429` | `RATE_LIMITED` |

### `POST /api/v1/auth/login`
Body: `{ "email": "…" | "phone": "…", "password": "…", "role"?: "PATIENT" | "DOCTOR" | "ADMIN" }`. Provide exactly one of `email` or `phone`.

If `role` is omitted, the active role is the least-privileged usable role, in the order PATIENT, DOCTOR, ADMIN.

| Status | Meaning |
|---|---|
| `200` | The auth result |
| `401` | `INVALID_CREDENTIALS`, for a wrong password or an unknown account (identical response and timing, so account existence isn't disclosed) |
| `403` | `ACCOUNT_SUSPENDED`, `ACCOUNT_DISABLED`, `ACCOUNT_NOT_ACTIVE`, `ROLE_NOT_ASSIGNED`, `ROLE_UNAVAILABLE` (for example a suspended doctor asking for DOCTOR) or `NO_USABLE_ROLE` |
| `429` | `RATE_LIMITED` |

### `POST /api/v1/auth/refresh`
Requires the `X-Fogaan-Client` header. Web clients send the cookie; native clients send `{ "refreshToken": "…" }`.

The refresh token is rotated on every call: the old token stops working, and the session keeps its absolute expiry. The active role is preserved unless it's no longer usable, in which case the session falls back to a usable role.

| Status | Meaning |
|---|---|
| `200` | The auth result, with a new refresh token |
| `401` | `REFRESH_TOKEN_INVALID`, `SESSION_REVOKED`, `SESSION_EXPIRED` or `REFRESH_TOKEN_REUSED` |
| `403` | Account no longer active (the session is revoked), or `CLIENT_HEADER_REQUIRED` |

`REFRESH_TOKEN_REUSED` means an already-rotated token was presented. **The whole session is revoked** and the event is audited.

### `POST /api/v1/auth/logout`
Requires the `X-Fogaan-Client` header. Ends the current session, identified by the bearer access token or else by the refresh token, and clears the cookie. Idempotent.

`204` → no content.

### `POST /api/v1/auth/logout-all`
Requires authentication. Revokes **every** session of the user, including this one.

`200` → `{ "data": { "revokedSessions": 3 } }`

### `POST /api/v1/auth/switch-role`
Requires authentication. Body: `{ "role": "PATIENT" | "DOCTOR" | "ADMIN" }`. Switches the session's active role to another role **already assigned** to the account. It never grants roles.

| Status | Meaning |
|---|---|
| `200` | The auth result, with a new access token and a rotated refresh token |
| `403` | `ROLE_NOT_ASSIGNED` or `ROLE_UNAVAILABLE` |
| `400` | Unknown role |

### `GET /api/v1/auth/me`
Requires authentication.

`200` → `{ "data": { "user": {…}, "roles": [...], "activeRole": "PATIENT", "permissions": [...], "profiles": {…}, "session": { "id", "expiresAt" } } }`

### Google sign-in

Server-side OpenID Connect authorization-code flow with PKCE (see [auth.md](auth.md#google-sign-in)). The browser never receives a Google token or the client secret, and no token is ever put in a URL.

#### `GET /api/v1/auth/providers`
Public. `200` → `{ "data": { "google": { "enabled": true } } }` (`false` when the API is not configured for Google).

#### `POST /api/v1/auth/google/start`
Public; needs `X-Fogaan-Client`; rate-limited like login. Body (strict, both optional): `{ "next": "/patient/doctors", "language": "en" | "so" }`. `next` must be an internal path; the web app re-checks it against the user's roles.

`200` → `{ "data": { "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth?…" } }`, and sets the one-time `fd_oauth` cookie. The web app then navigates to `authorizationUrl`.

`503 GOOGLE_UNAVAILABLE` when Google is not configured.

#### `POST /api/v1/auth/google/link`
Authenticated; needs `X-Fogaan-Client`. Body: `{ "language"? }`. Same response as `start`, bound to the signed-in user and session.

| Status | Code | When |
|---|---|---|
| `403` | `GOOGLE_ADMIN_NOT_ALLOWED` | The account has the ADMIN role (administrators are password-only) |
| `409` | `GOOGLE_ALREADY_CONNECTED` | A Google account is already connected |
| `503` | `GOOGLE_UNAVAILABLE` | Not configured |

#### `GET /api/v1/auth/google/callback`
Google's redirect target (`GOOGLE_REDIRECT_URI`). Always answers `303` to the web app and clears `fd_oauth`:

| Outcome | Redirect |
|---|---|
| Signed in / registered | `/auth/google/complete?next=…` and the normal `fd_refresh` cookie is set |
| Connected (link) | `/account/security?google=connected` |
| Sign-in failure | `/login?authError=<CODE>` |
| Link failure | `/account/security?googleError=<CODE>` |

Codes: `GOOGLE_CANCELLED`, `GOOGLE_FAILED`, `GOOGLE_STATE_INVALID` (missing/forged/expired/replayed attempt), `GOOGLE_EMAIL_UNVERIFIED`, `GOOGLE_EMAIL_EXISTS` (an account with that email exists and Google is not linked to it), `GOOGLE_ALREADY_LINKED` (that Google account belongs to another user), `GOOGLE_ALREADY_CONNECTED`, `GOOGLE_ADMIN_NOT_ALLOWED`, `GOOGLE_LINK_SESSION_INVALID`, `GOOGLE_UNAVAILABLE`, and the usual account codes `ACCOUNT_SUSPENDED`, `ACCOUNT_DISABLED`, `ACCOUNT_NOT_ACTIVE`, `NO_USABLE_ROLE`.

The web page `/auth/google/complete` then calls `POST /auth/refresh` (normal rotation) to get the access token.

#### `GET /api/v1/auth/methods`
Authenticated. `200` →
```json
{ "data": {
  "password": { "enabled": true },
  "google": { "available": true, "allowed": true, "connected": true, "email": "name@gmail.com",
              "connectedAt": "…", "lastUsedAt": "…", "canDisconnect": true } } }
```
`allowed` is `false` for administrators. `canDisconnect` is `false` when Google is the only way to sign in.

#### `DELETE /api/v1/auth/google`
Authenticated; needs `X-Fogaan-Client`. `200` → the same body as `/methods`. `404 GOOGLE_NOT_CONNECTED`; `409 LAST_SIGN_IN_METHOD` when the account has no password.

### Access-token errors (every protected endpoint)

| Status | Code | Meaning |
|---|---|---|
| `401` | `TOKEN_MISSING` | No bearer token was sent |
| `401` | `TOKEN_INVALID` | Bad signature, wrong issuer or audience, or malformed |
| `401` | `TOKEN_EXPIRED` | The access token has expired; call `/auth/refresh` |
| `401` | `SESSION_REVOKED` / `SESSION_EXPIRED` | The session behind the token has ended |
| `403` | `ACCOUNT_SUSPENDED` / `ACCOUNT_DISABLED` / `ACCOUNT_NOT_ACTIVE` | Checked on every request, so a still-valid JWT is not enough |
| `403` | `ROLE_UNAVAILABLE` / `ROLE_NOT_ASSIGNED` | The token's role is no longer usable, for example a suspended doctor |
| `403` | `ROLE_REQUIRED` / `PERMISSION_REQUIRED` | RBAC refused the request |

## Administration (`/api/v1/admin`)

All routes require an authenticated session whose **active role is ADMIN** and which has the `roles:assign` permission.

### `POST /api/v1/admin/users/:userId/roles`
Body: `{ "role": "ADMIN" }`. Only ADMIN can be granted here: PATIENT comes from registration, and DOCTOR only from approving a doctor application (see below). The grant is audited.

| Status | Meaning |
|---|---|
| `201` | `{ "data": { "userId": "…", "roles": [...] } }` |
| `400` | Not ADMIN, or invalid `userId` |
| `401` / `403` | Not authenticated, or not acting as ADMIN |
| `404` | User not found |
| `409` | `ROLE_ALREADY_ASSIGNED` |

## Doctor management

Doctors register as an ordinary account (PATIENT role) and then apply. **The DOCTOR role is granted only when an admin approves the application.**

Lifecycle (`doctor_profiles.verification_status`, mirrored by `verification_requests.status`):

```
NOT_SUBMITTED (draft) ──submit──▶ PENDING ──start-review──▶ UNDER_REVIEW
        ▲                            │                          │
        └──── edit + resubmit ◀── REJECTED ◀──reject (reason)───┤
                                     approve ──▶ VERIFIED (+ DOCTOR role)
```

### `GET /api/v1/specialties`
Public. Active specialties: `{ "data": [{ "id", "nameEn", "nameSo", "description" }] }`.

### Applicant (`/api/v1/doctor-application`)
Requires a session with the `doctor-application:manage:own` permission (PATIENT or DOCTOR active role).

| Method and path | Purpose |
|---|---|
| `GET /` | The caller's application (`data: null` before the first save). Includes `status`, `editable`, `completion { percent, missing, readyToSubmit }`, current `documents`, `documentHistory`, `history` (requests and reviews) and `rejectionReason`. Storage keys are never returned. |
| `PUT /` | Create or update the draft. Body (strict): `professionalName` 3–160, `specialtyId`, `licenceNumber` 3–60 (`A-Z 0-9 . / -` and space), `licenceCountry`, `consultationFee` 5–200 USD (≤ 2 decimals), `bio` 50–2000, `yearsExperience?` 0–60, `languages` (≥ 1 of `so en ar sw am om fr it`). Only while `NOT_SUBMITTED` or `REJECTED`, otherwise `409 APPLICATION_LOCKED`. |
| `POST /documents/:documentType` | Upload a new version of `MEDICAL_LICENSE`, `IDENTITY_PROOF` or `QUALIFICATION`. The body is the raw file (`Content-Type: application/octet-stream`), the display name goes in `X-File-Name` (URI-encoded). Max 5 MB (`413`). Type is detected from the file's bytes — PDF, JPEG or PNG — never from the name or MIME type (`415 FILE_TYPE_NOT_ALLOWED`); empty files `400 FILE_EMPTY`. Rate-limited (`UPLOAD_RATE_LIMIT_MAX`, default 30 per 15 min). |
| `GET /documents/:documentId/file` | Download one of the caller's own documents. Sent as an attachment with `Content-Security-Policy: default-src 'none'; sandbox` and `nosniff`. Another user's document is `404`. |
| `POST /submit` | Submit for verification. `409 APPLICATION_INCOMPLETE` (with `details.missing`) unless every required item, including the medical licence, is present. Creates a `PENDING` verification request and notifies admins. |

### Doctor (`/api/v1/doctors`)

`GET /me` — active role DOCTOR with `doctor-profile:read:own`: the approved profile shown on the doctor dashboard (status, specialty, fee, languages, documents, completion).

## Admin doctor management (`/api/v1/admin/doctors`)
Active role ADMIN with the `doctors:manage` permission.

| Method and path | Purpose |
|---|---|
| `GET /?tab=all\|verified\|pending\|rejected\|suspended&q=&page=&pageSize=` | Registered doctors (drafts excluded) with verification and account status, specialty, fee, licence, languages, contact details and, for suspended doctors, the latest suspension (reason, when, by whom, from the audit log). `counts` per tab; `q` searches name, email and licence number. |
| `POST /:doctorId/suspend` | Body `{ "reason" }` (10–500 chars, required). Calls the existing `suspendDoctor` service: account SUSPENDED, future appointments cancelled with full refund requests, patients notified, one `SUSPEND` audit entry. `409 DOCTOR_ALREADY_SUSPENDED`; `403 SELF_ACTION_FORBIDDEN` for the admin's own doctor profile; `404` for drafts or unknown ids. The doctor loses DOCTOR access on the very next request and leaves public discovery. |

## Appointments — patient (`/api/v1/appointments`)
Active role PATIENT with `appointments:manage:own`. The patient is always the signed-in user; ids of other people's appointments are `404`. Writes are rate-limited (`BOOKING_RATE_LIMIT_MAX`, default 30 per 15 min).

| Method and path | Purpose |
|---|---|
| `POST /` | Body `{ slotId, reason? }` (strict — no price or status from the client). Reserves the slot through `reserveSlot`: slot row locked, doctor must be verified + active, `PENDING_PAYMENT` with a 10-minute hold, slot HELD. `409 SLOT_UNAVAILABLE` if taken (one active booking per slot is also enforced by a unique index); `403 SELF_BOOKING_FORBIDDEN`. Returns the appointment with `holdExpiresAt` and `serverTime` for the countdown. |
| `GET /?scope=upcoming\|past` | The patient's appointments. An unpaid hold past its deadline is shown as `EXPIRED`. |
| `GET /:id` | Details: doctor, time, fee, payment (found through the reschedule chain), refunds, status history, and `actions` — the server-computed cancellation refund preview and whether the free reschedule is allowed (with the blocker). |
| `POST /:id/cancel` | Body `{ reason? }`. Unpaid: released, no refund. Paid: refund request per the approved policy — more than 24 h before 100 %, 2–24 h 50 %, under 2 h none. The slot is offered again. |
| `POST /:id/reschedule` | Body `{ slotId }`. One free reschedule, only for a CONFIRMED appointment more than 24 h ahead, to an open slot of the same doctor: a linked new CONFIRMED appointment (`originalAppointmentId`, paid by the original payment), the original becomes `RESCHEDULED` and its slot is released. `409 RESCHEDULE_NOT_ALLOWED` with `details.blocker` (`NOT_CONFIRMED`, `ALREADY_RESCHEDULED`, `TOO_LATE`). |

## Appointments — doctor (`/api/v1/doctors/me/appointments`)
Active role DOCTOR with `appointments:manage:doctor`: `GET /?scope=`, `GET /:id` (patient name, never contact details) and `POST /:id/cancel` with a required `reason` (10–500). A doctor cancellation is always a full refund; the slot is withdrawn and the patient notified.

## Dashboards (real data, no sample figures)

| Method and path | Purpose |
|---|---|
| `GET /api/v1/appointments/summary` | PATIENT. `{ counts: { upcoming, completed, prescriptions, documents }, nextAppointment, serverTime }`. `upcoming` = own `CONFIRMED`/`WAITING`/`IN_PROGRESS` not yet ended (unpaid holds excluded); `prescriptions` = issued (non-draft); `documents` = non-archived medical documents. `nextAppointment` is the soonest of those: `{ id, status, startAtUtc, endAtUtc, durationMinutes, doctor: { id, name, specialty, photoUrl }, canJoin, canReschedule }` (actions computed by the same rules as the appointment detail), or `null`. |
| `GET /api/v1/doctors/me/appointments/summary?tz=` | DOCTOR. The day in `tz` (default: the doctor's own zone): `{ timeZone, today, days (7 dates), stats: { today, waiting, completed30d, earnings30d: { amount, currency, simulated } \| null }, schedule: [appointment list items + day], serverTime }`. `schedule` = own paid visits (`CONFIRMED`/`WAITING`/`IN_PROGRESS`) in the next 7 days; `earnings30d` = calculated net after commission and refund deductions (same as My earnings). |
| `GET /api/v1/public/stats` | Public, cached 5 minutes, public rate limit. `{ doctors, completedConsultations, rating: { average, count } \| null, specialties: [{ id, nameEn, nameSo, doctors }] }` — listed (verified, active) doctors only; counts, never personal data. |

The admin dashboard uses `GET /api/v1/admin/reports/overview` (30-day cards; Monday–Sunday custom range for the weekly chart) and the finance overview.

## Requirement features (follow-ups, ratings, refunds, chat files, admin tools, SMS)

| Method and path | Who | Purpose |
|---|---|---|
| `POST /api/v1/appointments/:id/no-show-refund` | PATIENT | Req. 6: the doctor has not admitted the patient 15 min after the start → appointment CANCELLED, slot withdrawn, **full** refund request, doctor notified, audited. `409 NO_SHOW_REFUND_NOT_ALLOWED` with `details.blocker` (`TOO_EARLY`, `ADMITTED`, `NOT_PAID`, `NOT_ELIGIBLE`) and `availableAt`. The appointment detail carries `actions.noShowRefund { allowed, blocker, availableAt }`. |
| `POST /api/v1/appointments/:id/review` | PATIENT | Req. 13: `{ rating: 1..5, comment? (≤1000) }`. COMPLETED appointments only (`409 REVIEW_NOT_ALLOWED`), once (`409 REVIEW_ALREADY_SUBMITTED`). Detail carries `actions.rate` and `review`. |
| `GET /api/v1/doctors/:doctorId/reviews?page=` | public | `{ average, count, distribution, items: [{ rating, comment, createdAt, author: "First L." }] }` for listed doctors. |
| `POST /api/v1/consultations/:consultationId/follow-up` | DOCTOR | Req. 12: `{ slotId, fee: NORMAL\|DISCOUNTED\|FREE }` on a COMPLETED consultation, own open slot. Creates a PENDING_PAYMENT FOLLOW_UP appointment (deadline: follow-up hours from Admin › Settings, default 48 h, never after the slot). `FOLLOW_UP_EXISTS`, `FOLLOW_UP_SLOT_INVALID`, `FOLLOW_UP_NOT_ALLOWED`. Patient notified (in-app + SMS). |
| `POST /api/v1/appointments/:id/confirm-free` | PATIENT | Confirms a free follow-up before its deadline (no payment). `409 FOLLOW_UP_NOT_FREE`. The detail shows `freeFollowUp` and `followUpOf { appointmentId, startAtUtc }`. |
| `POST /api/v1/appointments/:id/consultation-record` | PATIENT | Req. 5: creates the consultation record for an active reservation or paid booking so lab results can be attached with the normal document upload. Returns `{ consultationId }`. Doctors see those files only once the booking is paid. |
| `POST /api/v1/consultations/:id/documents/upload-url` | participant | Now also accepts `context: "CHAT"` (in-call chat, req. 8): the limit becomes **5 MB**. Patients may upload while the booking is PENDING_PAYMENT or CONFIRMED. |
| `PATCH /api/v1/admin/doctors/:doctorId` | ADMIN | Req. 1: edit `fullName, specialtyId, country, timeZone, yearsExperience, consultationFee (5–200), bio, languages`. Fee changes affect new bookings only. Audited. The list now includes `country`, `timeZone`, `bio`, `cancellationsThisMonth` and `cancellationFlag` (req. 11: more than 3 doctor cancellations this month; admins notified once). |
| `GET/POST/PATCH /api/v1/admin/specialties[/:id]` | ADMIN | The admin-managed specialty list: add `{ nameEn, nameSo }`, rename, `isActive` on/off (never deleted). `409 SPECIALTY_EXISTS`. Audited. |
| `GET /api/v1/notifications/sms?page=` | any | The signed-in user's simulated SMS outbox. |
| `GET /api/v1/admin/sms-outbox?q=&page=` | ADMIN | Every simulated SMS (number, text, status, recipient name). |
| `GET /api/v1/payments/:id/receipt?lang=en\|so` | PATIENT / ADMIN | Receipt PDF in English or Somali (default: the reader's language). |
| `GET /api/v1/payments/:paymentId/refunds/:refundId/receipt?lang=en\|so` | PATIENT | Req. 11: refund receipt PDF (refund id and reference, original payment, requested/paid-back dates, reason, amount, status), simulated. 404 for anyone else's. Admins: `GET /api/v1/admin/finance/payments/:paymentId/refunds/:refundId/receipt`. |

Other rule changes: the join window is **[start − 10 min, start + 30 min]**; a FAILED payment releases the slot
immediately (`EXPIRED`, pay again → `409 APPOINTMENT_NOT_PAYABLE`); search lists only doctors with a free slot
in the next 30 days; ending or completing a consultation without any note text → `409
CONSULTATION_NOTES_REQUIRED`; `GET /api/v1/doctors/me/earnings` adds `byMonth` (fully refunded excluded).

## Simulated payments and refunds (DEMO — no real provider, no real money)

Providers `EVC_PLUS`, `ZAAD` and `EDAHAB` are **simulated adapters** (`apps/api/src/adapters/payment/`) behind one interface (`validateWallet`, `charge`, `checkStatus`, `refund`); a real provider later replaces one entry in the registry. The **server** decides each outcome from documented demo wallet numbers (last four digits `0001` fail, `0002` stays pending, `0003` pending then approved, `0004` refund fails, anything else succeeds); the client never sends an amount, a status or an outcome.

| Method and path | Purpose |
|---|---|
| `GET /api/v1/appointments/:id/checkout` | Reservation, payment so far, methods, demo numbers, `serverTime` (patient's own only). |
| `POST /api/v1/appointments/:id/payments` | Body `{ provider, wallet }` + required `Idempotency-Key` header (a repeat returns the first result, `replayed: true`). Appointment row locked; outcome `SUCCESS` (appointment CONFIRMED, ledger PAYMENT = COMMISSION + DOCTOR_EARNING, earning, slot BOOKED), `FAILED` (retry allowed while the hold is valid), `PENDING` (never confirms), or `EXPIRED` (hold over → Phase 4 expiry, slot released). `409 PAYMENT_ALREADY_SUCCEEDED`, `PAYMENT_PENDING`, `APPOINTMENT_NOT_PAYABLE`; `400 WALLET_INVALID`. Every attempt is audited with a unique `EVC-/ZAAD-/EDH-DEMO-…` reference. |
| `POST /api/v1/appointments/:id/payments/refresh` | Re-asks the simulated provider about a PENDING attempt (or expires it with the reservation). |
| `GET /api/v1/payments` | The patient's payments, attempts and refunds. |
| `GET /api/v1/payments/:paymentId/receipt` | DEMO receipt PDF (owner only; successful payments only — `409 RECEIPT_UNAVAILABLE`). |

Admin (`/api/v1/admin/finance`, ADMIN + `finance:manage`): `GET /overview` (simulated revenue, refunds, net, placeholder commission from the platform setting, pending/failed counts, by method), `GET /payments?status=&provider=&q=` (q: reference, patient or doctor), `GET /payments/:id` (attempts, append-only ledger, refunds, audit history), `GET /payments/:id/receipt`, `GET /refunds?status=&q=`, `POST /refunds/:id/process` (REQUESTED → PROCESSING claimed under a row lock, simulated refund, then the existing `completeRefund` / `failRefund`; `409 REFUND_NOT_REQUESTED` on a second attempt), `POST /refunds/:id/retry` (a FAILED refund requested again for the same amount, never above what remains refundable).

Refund amounts follow the booking policy (patient > 24 h 100 %, 2–24 h 50 %, < 2 h none; doctor cancellation 100 %). Unpaid holds are released by the sweep in `server.js` (`HOLD_SWEEP_INTERVAL_SECONDS`, default 60), which also closes their open payment (attempt `EXPIRED`, payment `CANCELLED`).

## Doctor availability (`/api/v1/doctors/me/availability`)

Active role DOCTOR with `availability:manage:own`. The doctor is always the signed-in user; no doctor id is accepted. Reads work for any doctor; **every change requires a verified, active doctor** (`403 DOCTOR_NOT_BOOKABLE` for pending, rejected or suspended profiles — e.g. during licence re-verification). Changes are rate-limited (`AVAILABILITY_RATE_LIMIT_MAX`, default 60 per 15 min) and audited.

**Time model.** Weekly hours are wall-clock times (`HH:MM`, 24 h) in the schedule's IANA zone (e.g. `Africa/Mogadishu`). Every stored instant — slots and blocks — is UTC. Each change re-plans the doctor's slots for the next 28 days in the same transaction.

| Method and path | Purpose |
|---|---|
| `GET /` | `{ canManage, timeZone, slotDurationMinutes, horizonDays, rules: [{ id, dayOfWeek (0 = Sun), startTime, endTime, slotDurationMinutes, timeZone }], blocks: [{ id, startAt, endAt, reason }] }` (blocks that have not ended). |
| `GET /calendar?from=YYYY-MM-DD&days=7&tz=` | The doctor's slots (every status) and blocks for `days` civil days starting `from`, grouped by date **in `tz`** (default: the schedule zone). |
| `PUT /schedule` | Replace the weekly schedule ("Save changes"). Body: `{ timeZone, slotDurationMinutes: 20 \| 30, days: [{ dayOfWeek, periods: [{ startTime, endTime }] }] }`. Up to 4 periods per day (gaps between them are breaks); periods may not overlap and must fit at least one consultation. Unchanged periods keep their rule; removed ones are deactivated (kept for history). Response includes `slots: { created, removed }`. |
| `DELETE /rules/:ruleId` | Remove one weekly period (soft). Another doctor's rule is `404`. |
| `POST /blocks` | Block whole days `{ kind: "DAYS", timeZone, startDate, endDate, reason? }` (≤ 90 days) or a period `{ kind: "PERIOD", timeZone, date, startTime, endTime, reason? }`. Converted to UTC using the zone. `409 BLOCK_OVERLAP`, `400 BLOCK_IN_PAST`; at most one year ahead. Open slots inside are withdrawn; held/booked slots are kept and counted in `keptBooked`. |
| `DELETE /blocks/:blockId` | Remove a block that has not ended (past blocks stay as history, `409`). Another doctor's block is `404`. |

**Slot generation rules:** future only; never inside a blocked period; never overlapping another slot (also enforced by the `availability_slots_no_overlap` exclusion constraint) or an active appointment; held/booked slots and slots with appointment history are never replaced; re-running changes nothing (idempotent). On daylight-saving days, wall times that do not exist are skipped, ambiguous times use the earlier instant, and a slot that would span the change is skipped.

**Daily job:** `npm run slots:sync` rolls the 28-day window forward for every verified doctor and withdraws unbooked slots of doctors who are no longer verified + active. It goes through `db-guard` (on production it needs `ALLOW_PRODUCTION_DB=true`).

## Public doctor directory (`/api/v1/doctors`)

No login. Only doctors that are VERIFIED, ACTIVE and whose account is ACTIVE are ever returned; others are `404`. Responses contain public fields only — never licence numbers, documents, verification records, email, phone or user ids. Rate-limited per IP (`PUBLIC_RATE_LIMIT_MAX`, default 300 per 5 min).

| Method and path | Purpose |
|---|---|
| `GET /?q=&specialtyId=&language=&minFee=&maxFee=&sort=&page=&pageSize=` | Search by doctor name or specialty (English or Somali), filter by specialty, language and fee range. `sort`: `rating` (default), `priceLow`, `priceHigh`, `reviews`, `soonest`. Items: `{ id, name, specialty, consultationFee, currency, languages, yearsExperience, verified, rating, reviewCount, nextAvailableAt }`. Unknown query keys are rejected. |
| `GET /:doctorId` | Public profile: the above plus `bio`, `verifiedSince` (month), `timeZone` (the doctor's schedule zone) and `slotDurationMinutes`. |
| `GET /:doctorId/slots?from=&days=7&tz=` | Open (AVAILABLE, future) slots grouped by civil date **in the viewer's zone `tz`**: `{ timeZone, doctorTimeZone, from, days: [{ date, slots: [{ id, startAtUtc, endAtUtc }] }] }`. Browsing never creates a booking or payment. |

### Admin verification (`/api/v1/admin/doctor-applications`)
Active role ADMIN with the `doctors:verify` permission.

| Method and path | Purpose |
|---|---|
| `GET /?tab=pending\|verified\|rejected` | Applications per tab (pending includes `UNDER_REVIEW`) plus `counts` for all three tabs. Drafts are never listed. |
| `GET /:doctorId` | Full application including applicant contact details, documents, previous versions and history. |
| `GET /:doctorId/documents/:documentId/file` | Secure document download (same headers as above). |
| `POST /:doctorId/start-review` | `PENDING → UNDER_REVIEW`. |
| `POST /:doctorId/approve` | Body `{ "notes"? }`. Sets VERIFIED, grants the DOCTOR role, notifies the applicant. |
| `POST /:doctorId/reject` | Body `{ "reason" }` (10–1000 chars, shown to the applicant). No role is granted; the applicant may edit and resubmit. |

Decisions: `403 SELF_REVIEW_FORBIDDEN` when the admin is the applicant; `409 INVALID_STATUS_TRANSITION` for an already-decided application. Every save, upload, submission, decision and role grant is written to `audit_logs`; earlier requests, reviews and document versions are never overwritten.

## Planned modules

Not implemented yet: `appointments` (booking, rescheduling) · `consultations` · `prescriptions` · `payments` · `messages` · `records` · `admin` (reports, audit-log views).

The database services for several of these already exist in `apps/api/src/modules` (see [database.md](database.md)); their HTTP routes come with each module.

## Notifications (`/api/v1/notifications`)

Any signed-in user (patient, doctor or admin); every call acts on the caller's own notifications only (another user's id is `404`). Writes need `X-Fogaan-Client`. Notifications are created only by backend services, inside the transaction of the event, with a per-user event key so the same event is never stored twice. Text is rendered when read, in `lang` (`en` | `so`) and the reader's time zone `tz` (times are stored in UTC). Email and SMS are not used.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/?lang&tz&unread=true&limit=1..50&cursor` | Newest first; `{ items, nextCursor, unreadCount }`. Items: `{ id, kind, type, title, body, url, read, readAt, createdAt }` |
| `GET` | `/unread-count` | `{ unreadCount }` |
| `GET` | `/stream?lang&tz` | Server-Sent Events: `ready`, `notification` (`{ item, unreadCount }`), `sync` (`{ unreadCount }`). Bearer auth; closes after 10 min, clients reconnect |
| `PATCH` | `/:id` | `{ "read": true | false }` |
| `POST` | `/read-all` | Marks all as read |
| `DELETE` | `/:id` | Deletes one notification |
| `GET` / `PUT` | `/preferences` | `{ inAppEnabled, pushEnabled, remindersEnabled, push: { available, publicKey, devices } }`. `inAppEnabled` affects optional notifications (reminders) only; essential ones are always kept |
| `POST` | `/push-subscriptions` | Body: the browser's `PushSubscription.toJSON()`. HTTPS endpoints of known push services only (`400 PUSH_ENDPOINT_NOT_ALLOWED`); `503 PUSH_UNAVAILABLE` without VAPID keys. One row per browser; several devices per user |
| `DELETE` | `/push-subscriptions` | `{ "endpoint" }` — this device only |

Push payloads contain only a title, a short text (names and times), an in-app link and a tag — never diagnoses, notes, cancellation reasons or records. Subscriptions answered with `404`/`410` by the push service are deleted.

**Reminders** (`appointment_reminders`): 24 h, 1 h and 10 min before every CONFIRMED appointment, for patient and doctor. The API's reminder sweep (every minute) plans missing rows, cancels those of appointments that are no longer confirmed, and sends due ones after re-checking the appointment status. A reminder missed by more than its grace window (3 h / 20 min / 7 min) is skipped rather than sent late.

## Video consultations (`/api/v1/consultations`)

One-to-one, peer-to-peer WebRTC calls between an appointment's own patient and its assigned doctor.
Signed-in PATIENT or DOCTOR (active role), `ownConsultationsJoin` permission, `X-Fogaan-Client` header on
writes. Someone else's appointment/consultation answers **404**. Nothing is recorded.

**Eligibility (enforced on every join, ticket and admit):** appointment `CONFIRMED`/`WAITING`/`IN_PROGRESS`;
covered by a `SUCCEEDED` payment (following reschedule links) with no requested/processing/paid refund;
inside the join window **[start − 10 min, start + 30 min]** (an in-progress call can be reconnected after that) (UTC, inclusive); doctor verified and active.
Errors (409): `CONSULTATION_NOT_JOINABLE`, `CONSULTATION_NOT_PAID`, `CONSULTATION_TOO_EARLY`,
`CONSULTATION_TOO_LATE` (details: `opensAt`, `closesAt`), `CONSULTATION_ENDED`; 403 `DOCTOR_NOT_ACTIVE`,
`CONSULTATION_DOCTOR_ONLY`; 409 `PATIENT_NOT_WAITING`.

| Method | Path | Who | Effect |
|---|---|---|---|
| POST | `/:appointmentId/join` | patient, doctor | Creates the consultation once (row lock + unique key), records `PATIENT_JOINED`/`DOCTOR_JOINED`; a patient enters the waiting room (appointment `CONFIRMED → WAITING`, doctor notified once). Returns `{ consultation, signaling: { ticket, expiresAt, path }, iceServers }`. |
| POST | `/:consultationId/ticket` | patient, doctor | A fresh signaling ticket (reconnect). |
| GET | `/:consultationId` | patient, doctor | State: `status`, `admission` (`WAITING`/`REJECTED`/`IN_CALL`/`ENDED`/`NOT_JOINED`), window, names, `startedAt`, `durationSeconds`, `endedBy`, presence, `serverTime`; the doctor also gets the note. |
| POST | `/:consultationId/admit` | doctor | `IN_PROGRESS`, `admittedAt`, `startedAt` (once), `DOCTOR_ADMITTED` + `CALL_STARTED`, appointment `IN_PROGRESS`, patient notified. |
| POST | `/:consultationId/reject` | doctor | `DOCTOR_REJECTED`; nothing is completed or cancelled; patient notified; the patient may wait again. |
| POST | `/:consultationId/leave` | patient, doctor | `PATIENT_LEFT`/`DOCTOR_LEFT`; the call is **not** ended. |
| POST | `/:consultationId/end` | doctor | `COMPLETED`, `endedAt`, server `durationSeconds`, `endedBy = DOCTOR`, `CALL_ENDED`, appointment `COMPLETED`, note locked 24 h after completion (existing rule), patient notified. |
| PUT | `/:consultationId/note` | doctor | Existing `saveNote` rules (fields `complaint`, `assessment`, `diagnosis`, `advice`, `share*`). |

Appointment details (`GET /api/v1/appointments/:id`, `GET /api/v1/doctors/me/appointments/:id`) include
`actions.join: { allowed, blocker, opensAt, closesAt }` and `consultation: { id, status }`.

### Signaling WebSocket — `/api/v1/consultations/signal`

- No query string is accepted (tickets/tokens never go in URLs). Browser `Origin` must be in `CORS_ORIGIN`.
- First message within 5 s: `{ "type": "auth", "ticket": "…" }`. Tickets are 256-bit random, single-use, valid
  60 s, bound to user + role + consultation (only a hash is kept, in memory). The user must still be that
  consultation's participant. Close codes: 4001 bad/expired/reused ticket, 4003 not a participant,
  4008 rate limited, 4009 replaced by a newer connection of the same participant, 4010 consultation ended,
  1009 frame over 64 KB.
- Server → client: `ready`, `presence {patient, doctor}`, `state-changed` (re-read GET state), `negotiate`
  (doctor: create a new offer), relayed messages, `error {code}`.
- Client → server (relayed only after admission, rebuilt from validated fields): `offer` (doctor), `answer`
  (patient), `candidate`, `media {audio, video}`, `restart` (patient asks for an ICE restart), `ping`.
- Unexpected socket closes record `PARTICIPANT_DISCONNECTED`; the next connection records
  `PARTICIPANT_RECONNECTED`. SDP and candidates are never logged or stored.
- In-process hub: running several API instances needs sticky sessions or a shared pub/sub.

### Deployment notes

- HTTPS is required for camera/microphone access (except `localhost`).
- The reverse proxy must forward WebSocket upgrades for `/api/v1/consultations/signal` (e.g. nginx
  `proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`)
  and allow long-lived connections (idle timeout > 30 s; the server pings every 20 s).
- Media flows browser-to-browser (UDP). **STUN only:** calls fail on some carrier-grade NAT / restrictive
  networks; users then see a clear message with Try again / Audio only. A TURN server (e.g. coturn on 443/TLS
  with short-lived credentials) is the fix and plugs into `apps/api/src/config/webrtc.js`.

## Admin finance (`/api/v1/admin/finance`)

ADMIN role + `finance:manage`; writes also need `X-Fogaan-Client`. All payments are **simulated**
(EVC Plus / ZAAD / eDahab demo adapters) — no real money moves and no provider is contacted.

**Date ranges** (every report): `preset` = `today` | `7d` | `30d` | `month` | `all` | `custom`
(+ `fromDate`, `toDate` as `YYYY-MM-DD`, inclusive, max 366 days) and `tz` (IANA zone, default
`Africa/Mogadishu`). Ranges are half-open `[from, to)` on calendar days in that zone. Error
`FINANCE_RANGE_INVALID` (400).

**Definitions.** Gross payment volume = successful payments by `paid_at` (not net revenue). Refunds =
refunds paid out by `processed_at`. Platform commission / doctor earnings = the split **saved when each
payment succeeded** (`doctor_earnings`, rate in `appointments.commission_rate_snapshot`) minus the share
reversed by refunds, allocated cumulatively from that same snapshot. The current commission setting is
never used for history.

| Method | Path | Notes |
|---|---|---|
| GET | `/overview?preset…` | Gross volume, refunds, net after refunds, platform & doctor earnings, payment counts by status, open/failed/rejected refunds, by method, current rate. No range = all time. |
| GET | `/payments?status&provider&q&preset…&page&pageSize` | Search by payment id, appointment id, provider reference, patient or doctor name. Each item has `refundState` (`NONE`/`REQUESTED`/`PARTIAL`/`FULL`). |
| GET | `/payments/:id` | Attempts, appointment, saved `allocation` (gross, rate, commission, doctor earning), ledger, audit. |
| GET | `/refunds?status&q&preset…` | Status `REQUESTED` (pending) / `PROCESSING` / `SUCCEEDED` (completed) / `FAILED` / `REJECTED`. |
| GET | `/refunds/:id` | Refund, original payment (+ remaining refundable), appointment, decision history. |
| POST | `/refunds/:id/process` | Approve: simulated payout (existing rules); records reviewer. Concurrent approvals → one 200, one 409. |
| POST | `/refunds/:id/reject` | `{ reason }` (10–500 chars). `REQUESTED` → `REJECTED`, reviewer/time/reason stored and audited, patient notified, amount released. |
| POST | `/refunds/:id/retry` | A failed refund is requested again. |
| GET | `/doctor-earnings?preset…&q&page` | Per doctor: paid & completed consultations, gross, refunds, refund deductions, commission, net. **Calculated only — no payouts exist** (`paidOut: null`). |
| GET | `/reports?preset…` | Revenue summary, by method, refund summary, commission (incl. by saved rate), doctor earnings, daily (≤ 92 days) and monthly trends. |
| GET | `/reports/export?type=summary\|payments\|refunds\|doctor-earnings&preset…` | CSV (UTF-8 BOM). No contact details or wallet numbers; formula-looking cells are prefixed with `'`. |
| GET | `/settings` | Current commission (fraction + percent, who/when) and change history. |
| PUT | `/settings/commission` | `{ percent: "0"–"100" (≤ 2 decimals), confirm: true }`. Audited (old, new, admin). Applies to **new reservations only**. `COMMISSION_INVALID` / `COMMISSION_UNCHANGED`. |

**Ledger.** Append-only (`financial_transactions`, unique `reference`). A successful payment posts
PAYMENT = PLATFORM_COMMISSION + DOCTOR_EARNING (metadata: appointment, patient, doctor, rate, source).
A refund paid out posts REFUND plus two ADJUSTMENT entries (`PLATFORM_COMMISSION_REVERSAL`,
`DOCTOR_EARNING_REVERSAL`) linked to the original references. `doctor_earnings` amounts and
`appointments.commission_rate_snapshot` are protected by database triggers.

## Admin console (`/api/v1/admin/patients`, `/appointments`, `/reports`, `/audit-logs`)

ADMIN role; each router checks its own permission. Responses are `Cache-Control: private, no-store`.
Date filters use the admin finance range fields (`preset`, `fromDate`, `toDate`, `tz`); an invalid range is
`400 FINANCE_RANGE_INVALID`. None of these endpoints return clinical data (date of birth, sex, address,
emergency contact, visit reason, medical history, documents, prescriptions, notes or messages).

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/admin/patients?tab=all\|active\|suspended&q=&page=&pageSize=` | `patients:manage`. `q` matches name, email or phone. Items `{ patientId, userId, name, email, phone, status, registeredAt, lastLoginAt, appointments, totalPaid, suspension }`; plus `counts` per tab. |
| GET | `/api/v1/admin/patients/:patientId` | `{ patient: { …row, preferredLanguage, roles, isDoctor, canSuspend, suspendBlocker }, appointments (≤50: id, status, start/end, fee, doctor), payments (≤50: amount, refunded, status, provider, paidAt) }`. `404` if unknown. |
| POST | `/api/v1/admin/patients/:patientId/suspend` | Body `{ reason }` (10–500 chars); needs the client header. One transaction: user `SUSPENDED` (sign-in refused with `ACCOUNT_SUSPENDED` and every request re-checks the status, so the patient can neither use the app nor book), all active sessions revoked, audit `SUSPEND` / `PatientAccount` (reason, sessions revoked, count of upcoming appointments). **Existing appointments are not touched**: not cancelled, slots not released, no refund requested. Errors: `PATIENT_ALREADY_SUSPENDED` (409), `PATIENT_ACCOUNT_PROTECTED` (403, administrators), `PATIENT_IS_ACTIVE_DOCTOR` (409 — suspend the doctor from Admin › Doctors first), `SELF_ACTION_FORBIDDEN`. Returns `{ sessionsRevoked, upcomingAppointments, patient }`. |
| POST | `/api/v1/admin/patients/:patientId/reactivate` | Body `{ reason? }`. `SUSPENDED` → `ACTIVE` (appointments were never changed by the suspension). Audit `UPDATE` / `PatientAccount` with `{ status: ACTIVE, reason, reactivated: true }`. `PATIENT_NOT_SUSPENDED` (409). |
| GET | `/api/v1/admin/appointments?preset=&…&status=&q=&page=&pageSize=` | `appointments:monitor`. Range applies to the start time (default `all`); `q` matches patient or doctor name. `{ range, statusCounts, items: [{ id, status, bookingType, start/end, fee, rescheduled, bookedAt, paymentStatus, patient, doctor }], total, page, pageSize }`. |
| GET | `/api/v1/admin/appointments/:appointmentId` | The list item plus `cancellationReason`, `cancelledAt`, `rescheduleCount`, `commissionRate`, `statusHistory`, `payment`, `refunds`, `consultation` (status and times only) and `earning`. Read-only. |
| GET | `/api/v1/admin/reports/overview?preset=&…` | `reports:read`. Default `30d`. `{ users: { newPatients, newDoctors, totalPatients, activeDoctors }, appointments: { total, booked, byStatus, paid, completed, noShow, cancelled, completionRate, noShowRate, cancellationRate }, topSpecialties, topDoctors, granularity: day\|month, trend: [{ period, appointments, completed, cancelled }] }`. Appointments count by start time, bookings by creation time; rates are fractions (or `null`). Money stays in Admin finance reports. |
| GET | `/api/v1/admin/reports/export?preset=&…` | The same figures as CSV (formula-safe cells). 20 per minute. |
| GET | `/api/v1/admin/audit-logs?preset=&…&action=&entityType=&actorUserId=&q=&page=&pageSize=` | `audit:read`. Default `7d`. Excludes clinical audit types (`Prescription`, `MedicalDocument`, `MedicalHistoryEntry`, `PatientMedicalHistoryAccess`, `SecurityEvent` — see Admin medical records). `q` matches the actor's name. Items `{ id, at, action, entityType, entityRef, actor: { userId, name, role }, oldValues, newValues }`; values pass an allow-list of non-personal keys and ids become 8-character references. Also returns `entityTypes` for the filter. |

### Booking rules (`/api/v1/admin/settings`)

Permission `settings:manage`. The rules live in one `PlatformSetting` row (`booking_policy`); anything not
stored falls back to the defaults, so behaviour only changes after an administrator saves. Rules are read
when they are applied (reserving, cancelling, rescheduling, appointment detail) — existing holds, refunds
and appointments are never recalculated. The 50 % partial-refund rate and the doctor/system full refund
are fixed.

| Field | Default | Range | Used by |
|---|---|---|---|
| `paymentHoldMinutes` | 10 | 5–60 | New standard reservations (slot `HELD` until then) |
| `followUpDeadlineHours` | 48 | 1–168 | New follow-up reservations (capped at the slot start) |
| `maxFreeReschedules` | 1 | 0–5 | Reschedule blocker `ALREADY_RESCHEDULED` |
| `freeRescheduleMinHours` | 24 | 0–168 | Reschedule blocker `TOO_LATE` (must be more than this many hours ahead) |
| `fullRefundMinHours` | 24 | 1–168 | Patient cancellation: more than this → 100 % |
| `partialRefundMinHours` | 2 | 0–72 | Patient cancellation: at least this → 50 %, below → 0 %; must be less than `fullRefundMinHours` |

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/admin/settings` | `{ bookingPolicy: { values, defaults, limits, updatedAt, updatedBy, history (≤20: at, by, before, after) }, commission: { percent, managedIn } }`. Commission is read-only here (Admin finance settings). |
| PUT | `/api/v1/admin/settings/booking-policy` | Body: all six fields as integers plus `confirm: true`; needs the client header. `400 BOOKING_POLICY_INVALID` (with per-field details), `409 BOOKING_POLICY_UNCHANGED`. Audit `UPDATE` / `PlatformSetting` / `booking_policy` with only the changed fields. Returns the same shape as GET. |

Patient/doctor appointment detail responses now include `policy: { fullRefundMinHours, partialRefundMinHours,
freeRescheduleMinHours, maxFreeReschedules }` so the cancellation and reschedule wording matches the rules in force.

## Messages (`/api/v1/messages`)

PATIENT or DOCTOR role, permission `messages:own`. One text conversation per **paid** appointment
(`CONFIRMED`, `WAITING`, `IN_PROGRESS`, `COMPLETED`), between the patient and the assigned doctor only;
administrators have no access. Writing is open from payment until **7 days** after the consultation ended
(or the slot ended if no call took place); after that the conversation is read-only. Anything that is not
the viewer's eligible appointment is the same `404 CONVERSATION_NOT_FOUND`. Responses are
`Cache-Control: private, no-store`. Messages are stored in `messages` (`appointment_id`, optional
`consultation_id` once the call exists, `read_at` = when the other participant opened it).

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/messages/conversations` | Conversations that have messages or are still open, latest activity first: `{ items: [{ appointmentId, appointmentStatus, startAtUtc, counterpart: { userId, name, role, specialty?, photoUrl }, open, closesAt, lastMessage, unread }], unreadTotal, windowDays }`. The patient's photo URL is the doctor's gated route; the doctor's is the public directory photo. |
| GET | `/api/v1/messages/conversations/:appointmentId?before=<messageId>` | `{ conversation, messages (≤50, oldest first: id, body, mine, createdAt, readAt), hasMore }`; `before` pages back. |
| POST | `/api/v1/messages/conversations/:appointmentId/messages` | Body `{ body }` (trimmed, 1–2000 chars); client header required; `MESSAGE_RATE_LIMIT_MAX` per minute (default 30). `201` with the message. `409 CONVERSATION_CLOSED` after the window. Publishes a `message` event to both participants. |
| POST | `/api/v1/messages/conversations/:appointmentId/read` | Marks the other person's messages read (`{ marked }`); publishes `message-read`. |
| GET | `/api/v1/messages/unread-count` | `{ unreadMessages }` for the menu badge. |

The notification stream (`GET /api/v1/notifications/stream`) now also emits `message` and `message-read`
events with `{ appointmentId, messageId }` only; clients reload through the endpoints above.

## Profiles (Phase 9)

Every private endpoint acts on the signed-in user only — no user, patient or entry owner id is accepted from
the client. Writes need `X-Fogaan-Client`. Request bodies are strict (unknown keys → `400 VALIDATION_ERROR`),
so roles, statuses, verification fields, email and phone can never be changed through them.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/me/profile` | PATIENT role. Personal details, emergency contact, address, account (created, status, roles, sign-in methods), `completeness` (informational only), `nameLocked`. |
| PATCH | `/api/v1/me/profile` | PATIENT role. Any of `fullName`, `preferredLanguage`, `dateOfBirth` (YYYY-MM-DD / null), `sex` (`FEMALE`/`MALE`/`PREFER_NOT_TO_SAY`/null), `address` ({city, addressLine} / null), `emergencyContact` ({name, relationship, phone E.164} / null). Email and phone are read-only (no change-verification flow yet). `409 NAME_LOCKED_BY_DOCTOR_PROFILE` when a submitted/verified doctor tries to rename. Audit stores field names only. |
| GET | `/api/v1/me/photo` | Own photo (any role), `image/jpeg`, `Cache-Control: private, no-store`. |
| PUT | `/api/v1/me/photo` | Raw bytes (≤ 2 MB). JPEG/PNG only, detected from the bytes; 64–6000 px per side, ≤ 24 MP; decoded and re-encoded with sharp to a 512×512 JPEG with **no EXIF/XMP/IPTC/ICC** (GPS and camera data removed). Stored privately under a generated key; the previous file is deleted. `413`, `415 PHOTO_TYPE_NOT_ALLOWED`, `422 PHOTO_INVALID` / `PHOTO_DIMENSIONS`. |
| DELETE | `/api/v1/me/photo` | Removes the photo. |
| GET | `/api/v1/me/medical-history?includeArchived=true` | PATIENT role, own history only. Each entry: type, title, description, recordedAt, `source` (PATIENT/DOCTOR), `authorName` (doctor entries), `canEdit`, `canArchive`, `archivedAt`. |
| POST | `/api/v1/me/medical-history` | `{ entryType, title, description?, recordedAt? }`. Types: ALLERGY, CONDITION, MEDICATION, SURGERY, FAMILY_HISTORY, OTHER. |
| PATCH | `/api/v1/me/medical-history/entries/:entryId` | Own (patient-written) entries only. Doctor-written → `403 HISTORY_DOCTOR_ENTRY_READ_ONLY`; archived → `409 HISTORY_ENTRY_ARCHIVED`; another patient's → `404`. |
| POST | `/api/v1/me/medical-history/entries/:entryId/archive` | Archive any entry in the own history (including doctor-written). Archived entries are frozen. |
| GET | `/api/v1/doctors/me/profile` | DOCTOR role (verified). Professional details, `qualifications`, photo, `verification` (status, verifiedAt, latest request, re-verification), licence (private), `listedPublicly`, `completeness`. |
| PATCH | `/api/v1/doctors/me/profile` | DOCTOR role, verified + active. Any of `bio`, `qualifications`, `yearsExperience`, `consultationFee` (new bookings only — appointments keep `fee_amount`), `languages`. Name, specialty, licence and verification fields are refused. `409 DOCTOR_PROFILE_LOCKED`. |
| POST | `/api/v1/doctors/me/licence?licenceNumber&licenceCountry&confirm=true` | Raw bytes (PDF/JPEG/PNG ≤ 5 MB). Replaces the licence **and starts Option A re-verification** in one transaction: PENDING + new verification request, DOCTOR role removed (PATIENT kept), weekly availability rules deactivated, open slots withdrawn; admins notified. |
| GET | `/api/v1/doctors/:doctorId/photo` | Public, listed (verified + active) doctors only; otherwise 404. |
| POST | `/api/v1/auth/password` | `{ currentPassword, newPassword, newPasswordConfirmation }`. Rate-limited, re-authenticates with the current password, revokes every **other** session (the current one keeps working and rotating), audited without the password. `400 CURRENT_PASSWORD_INVALID`, `409 PASSWORD_NOT_SET` (Google-only accounts). |

Public doctor responses (`/api/v1/doctors`, `/api/v1/doctors/:id`) now include `photoUrl` (relative to the API
base, e.g. `/v1/doctors/<id>/photo?v=…`) and, on the detail, `qualifications`. Contact details, licence data,
documents, verification notes and storage keys are never included.

**Medical history integrity (database trigger `medical_history_entries_protect`).** Rows cannot be deleted;
`source`, `created_by_user_id`, `medical_history_id`, `consultation_id` and `created_at` cannot change; an
archived row cannot be updated. Consultation notes and prescriptions remain separate records.

**Re-verification and availability.** Revoking doctor privileges (licence replacement or rejection) also
deactivates the weekly availability rules, so neither approval nor the daily slot sync republishes old
availability: the doctor publishes again after re-approval.

### Assigned doctor: read-only patient information (Phase 9 addition)

Rule (one function, `authorizeAssignedDoctor`): the signed-in doctor is VERIFIED + ACTIVE and `appointmentId`
is **that doctor's own appointment with that patient** in `CONFIRMED`, `WAITING`, `IN_PROGRESS` or
`COMPLETED`. Knowing a patient id grants nothing; every denial is the same `403 PATIENT_ACCESS_DENIED`
(`DOCTOR_NOT_ACTIVE` for a suspended/unverified doctor). Responses are `Cache-Control: private, no-store`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/doctors/me/patients/:patientId/medical-history?appointmentId=` | `{ appointment: { id, status, activeConsultation }, patient: { id, name, age, sex, photoUrl, emergencyContact }, entries }`. `emergencyContact` only while the appointment is `IN_PROGRESS`. Never address, email, phone or account data. Entries are read-only (`canEdit` only on the doctor's own entries; never `canArchive`). Audited: `OTHER` / `PatientMedicalHistoryAccess` with `{ action: VIEW_MEDICAL_HISTORY, doctorId, patientId, appointmentId, consultationId, appointmentStatus, emergencyContactShown, entryCount }` — no medical content. |
| GET | `/api/v1/doctors/me/patients/:patientId/photo?appointmentId=` | The patient's photo for the assigned doctor (same rule), `image/jpeg`, audited as `VIEW_PATIENT_PHOTO`. |

The doctor's appointment list/detail (`/api/v1/doctors/me/appointments…`) and the consultation state now
include `patient.id` and `patient.photoUrl` (the gated route above, only for eligible statuses; `null`
otherwise). Patient-facing responses are unchanged. Doctors still add entries / edit their own entries only
through the existing medical-history service rules (no new write endpoint).

### Doctor workspace: my patients and my earnings (`/api/v1/doctors/me`)

DOCTOR role. Responses are `Cache-Control: private, no-store`. Rate limit: `PATIENT_RECORDS_RATE_LIMIT_MAX`
per 15 minutes.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/doctors/me/patients?q=&page=&pageSize=` | Permission `patient-records:read:assigned`; doctor must be VERIFIED + ACTIVE. Only patients with at least one appointment with **this** doctor in `CONFIRMED`, `WAITING`, `IN_PROGRESS` or `COMPLETED` (cancelled/expired/rescheduled/no-show bookings never list a patient). `q` matches the name. Items `{ id, name, photoUrl, appointmentId, appointmentStatus, appointments, completedConsultations, lastVisitAt, nextVisitAt }` — `appointmentId` is the newest eligible appointment (what the photo URL and the Patient Information panel use). Patients with a visit ahead come first (soonest first), then by most recent visit. No age, sex or contact details (those stay behind the audited Patient Information route). `{ items, total, page, pageSize }`. |
| GET | `/api/v1/doctors/me/patients/:patientId` | Same rule; otherwise `403 PATIENT_ACCESS_DENIED`. `{ patient: <list item>, appointments: [{ id, status, startAtUtc, endAtUtc, reason, bookingType, rescheduled }] }` — every appointment the doctor has had with the patient (any status), newest first. |
| GET | `/api/v1/doctors/me/earnings?preset=&fromDate=&toDate=&tz=&status=&page=&pageSize=` | Permission `earnings:read:own`. The doctor's earning snapshots for consultations paid in the range (same range fields as admin finance; default `30d`). `status` ∈ `PENDING`, `AVAILABLE`, `PARTIALLY_REFUNDED`, `REFUNDED`. Each item `{ id, appointmentId, appointmentStatus, appointmentStartAt, patientName, paidAt, status, gross, commission, refunds, refundDeduction, net, currency }`; `refundDeduction` is the doctor's share of successful refunds (same allocation as admin finance). `{ simulated: true, currency, range, totals, statusCounts, items, total, page, pageSize, payoutsSupported: false }`. Calculated earnings only — no payouts exist. |

## File storage (Supabase Storage / local driver)

`STORAGE_DRIVER=local|supabase` (default `local`). Neon stays the database; Supabase is object storage only.
Supabase credentials (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) are read by the API only; the API refuses to
start if the key appears in a `VITE_*` variable. Private buckets (no anon/authenticated policies):
`fd-verification` (doctor-documents/, 5 MB), `fd-photos` (avatars/, 1 MB), `fd-prescriptions` (prescriptions/,
2 MB), `fd-medical` (medical-documents/, 10 MB), `fd-staging` (unvalidated uploads, removed after 24 h).
Keys are unchanged and server-generated; uploads never overwrite.

**Small files stay on the API path:** profile photos (re-encoded), licence replacement, prescription PDFs
(streamed with the SHA-256 check on every download) and public doctor photos (listed doctors only).

**Large files — staged upload (works within Vercel's ~4.5 MB body limit):**

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/consultations/:id/documents/upload-url` | Participant only. `{ fileName, size, contentType, category, description? }` → `{ uploadToken, upload: { url, method, headers }, expiresAt, maxBytes }`. Declared size/type checked. |
| PUT | `upload.url` | Browser sends the bytes to a random staging path (Supabase signed upload URL, or `/v1/storage/local/upload/:token` with the local driver; one use). |
| POST | `/api/v1/consultations/:id/documents/finalize` | `{ uploadToken }`. Re-authorises, then the token must match the same user, role and consultation; the staged object is claimed (single use — concurrent finalisations: one wins), then validated (type from bytes, structure, ≤ 10 MB, SHA-256) and stored + recorded + audited + notified. Refused bytes are not kept. `UPLOAD_NOT_FOUND`, `UPLOAD_ALREADY_FINALISED`, `UPLOAD_INTENT_INVALID`. |
| POST | `/api/v1/doctor-application/documents/:type/upload-url`, `/finalize` | Same flow for the applicant's verification documents (5 MB); stores `doctor_documents.sha256`. |

**Signed downloads (issued only after the access check, each audited as `SIGNED_URL_ISSUED`, valid 60 s):**
`GET /api/v1/medical-documents/:id/download-url`, `GET /api/v1/doctor-application/documents/:id/url`,
`GET /api/v1/admin/doctor-applications/:doctorId/documents/:id/url` → `{ url, expiresAt }` (absolute for
Supabase; relative to the API base for the local driver: `/v1/storage/local/download/:token`).

Maintenance: `npm run storage:cleanup-staging` (removes staging uploads older than 24 h);
`npm run storage:setup-dev` (creates/verifies the private buckets in the **development** project only).
See `docs/vercel-realtime.md` for WebSocket/SSE/scheduler constraints on Vercel.
