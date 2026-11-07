# Authentication and authorization

The API contracts are in [api.md](api.md). This document explains how authentication and authorization work.

## Components

| Layer | Files (`apps/api/src`) |
|---|---|
| Routes | `modules/auth/auth.routes.js`, `modules/users/user.routes.js` (admin) |
| Middleware | `middleware/authenticate.js`, `authorize.js` (`requireRole`, `requirePermission`, `requireActiveAccount`), `validate.js` (Zod), `rateLimit.js`, `cors.js`, `requireClientHeader.js` |
| Controllers | `auth.controller.js`, `user.controller.js` (thin) |
| Services | `auth.service.js`, `user.service.js` (all rules) |
| Repositories | `auth.repository.js`, `audit/audit.repository.js` (the only Prisma access) |
| Support | `auth.tokens.js` (JWT, refresh tokens), `auth.cookies.js` (delivery), `auth.validation.js`, `auth.permissions.js`, `config/auth.js`, `utils/password.js` |
| Google sign-in | `google.service.js`, `google.controller.js`, `oauth.state.js` (OAuth cookie, PKCE, replay guard), `adapters/oauth/googleOidc.js` (the only code that talks to Google), `config/google.js` |

## Passwords

Passwords are hashed with **bcrypt**. The cost is `BCRYPT_ROUNDS`, default 12 and minimum 10. Passwords are capped at **72 bytes**, because bcrypt ignores anything beyond that, and must contain a letter and a number.

Login runs a bcrypt comparison even for unknown accounts, so response time and body don't reveal whether an account exists. The query that reads the password hash is used only at login; every other query selects user fields without it.

## Tokens

- **Access token:** an HS256 JWT signed with `JWT_ACCESS_SECRET`. It carries `sub` (user), `sid` (session) and `role` (active role), plus `iss`, `aud`, `iat` and `exp`. The default lifetime is **15 minutes** (`ACCESS_TOKEN_TTL_SECONDS`). Clients keep it **in memory only**.
- **Refresh token:** an opaque string `v1.<sessionId>.<activeRole>.<256-bit random>`. The database stores **only its SHA-256 hash** (`sessions.refresh_token_hash`).
  - Because the hash covers the whole string, the session ID and role inside it can't be edited.
  - The session ID is what lets the server tie a replayed token back to its session.
  - The session lasts `REFRESH_TOKEN_TTL_DAYS` (default 30) as an **absolute** limit: rotation does not extend it.

The active role is part of the refresh token, so the approved `sessions` table needed no new column.

## Session lifecycle

```
register / login ──► new session row (hash of token T1), access token A1
refresh(T1)      ──► same session, hash := H(T2), returns T2 + A2         (T1 is now dead)
refresh(T1) again ─► hash mismatch on a live session = reuse ⇒ session REVOKED, audited, 401 REFRESH_TOKEN_REUSED
switch-role(R)   ──► same session, hash := H(T3 with role R), returns T3 + A3(role R)
logout           ──► revoked_at := now   (by access token, or by the current refresh token)
logout-all       ──► every live session of the user revoked
expiry           ──► refresh after expires_at ⇒ session revoked, 401 SESSION_EXPIRED
```

Outcomes that must persist even though the request fails are **committed before** the error is returned. That covers revocation after reuse, after expiry, or after an account was suspended. Every refresh takes a `SELECT … FOR UPDATE` lock on the session row.

## Delivering refresh tokens

| Client | Refresh token | Access token |
|---|---|---|
| Web browser (default) | `fd_refresh` cookie: `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth`, `Secure` in production. Never in a response body, never readable by JavaScript. | Response body, kept in memory |
| Native app (`X-Fogaan-Client: native`) | Response body. Store it in the Keychain or Android Keystore. | Response body |

A web request is never accepted with a body token, and a native request is never accepted with a cookie, so one can't be replayed as the other.

**CSRF:** `/refresh` and `/logout` act on the cookie, so they require the `X-Fogaan-Client` header. A cross-site page can't add a custom header without a CORS preflight, and CORS only allows the origins listed in `CORS_ORIGIN`. Together with `SameSite=Strict`, this blocks cross-site use of the cookie.

## Roles, the active role and RBAC

- **Multiple roles:** a user can hold several roles through `user_roles`. Each session has exactly one **active role**.
- **Default role at login:** the requested role, otherwise the least-privileged usable role (PATIENT → DOCTOR → ADMIN).
- **When a role is usable:** it must be assigned. DOCTOR also requires `doctor_profiles.account_status = ACTIVE`, so a suspended doctor loses doctor privileges while keeping the patient role. PATIENT requires a patient profile.
- **Role switching:** only to roles that are already assigned and usable. Switching never creates or grants roles.
- **Removing roles:** DOCTOR is removed automatically when a verified doctor's licence is replaced (re-verification) or an application is rejected; PATIENT is never removed. The next authenticated request of an existing DOCTOR session is refused (`ROLE_NOT_ASSIGNED`), and refresh falls back to PATIENT.
- **Granting roles:** `POST /api/v1/admin/users/:id/roles` grants only ADMIN, and only to an active ADMIN session with the `roles:assign` permission. DOCTOR is granted only by approving a doctor application (`doctors:verify`); choosing "Doctor" at registration creates a normal PATIENT account plus a pending application, never the role itself. Admins cannot review their own application. Grants are audited.
- **Permissions:** `auth.permissions.js` maps each role to its permissions:

  | Role | Permissions |
  |---|---|
  | PATIENT | `profile:read:own`, `sessions:manage:own`, `doctor-application:manage:own` |
  | DOCTOR | the above + `doctor-profile:read:own`, `availability:manage:own` |
  | ADMIN | `profile:read:own`, `sessions:manage:own`, `roles:assign`, `doctors:verify`, `doctors:manage` |

   `requirePermission()` checks the **active** role, so an admin acting as a patient has no admin rights.

**Each request is re-checked against the database.** `authenticate()` verifies the JWT and then loads the session and user in one query. It rejects the request if the session is revoked or expired, if the account isn't `ACTIVE` (suspended or disabled accounts lose access immediately), or if the token's role is no longer usable. A valid signature alone is never enough.

## Google sign-in

OpenID Connect, server-side authorization-code flow with PKCE. Configuration (API only; nothing is exposed to the browser): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `WEB_APP_URL`, `OAUTH_STATE_SECRET`. If any is missing or inconsistent, Google is reported as unavailable and the button says so. The API logs at startup whether Google sign-in is enabled (variable names only, never values).

**Flow**
1. The web app calls `POST /auth/google/start` (or `/auth/google/link` when signed in). The API creates a random `state`, `nonce` and PKCE verifier, stores them in the `fd_oauth` cookie and returns Google's URL with the S256 code challenge.
2. Google redirects to `GOOGLE_REDIRECT_URI`, which is on the web origin and proxied to the API, so every cookie stays first-party.
3. The callback:
   - clears `fd_oauth` whatever happens;
   - checks `state` (constant-time) and accepts each state once;
   - exchanges the code with the PKCE verifier and client secret directly with Google;
   - verifies the ID token: RS256 signature against Google's published keys (cached), issuer, audience = our client ID, expiry, `azp`, the nonce of this attempt, and `email_verified = true`.
4. A session is created with the existing `startSession` (same audit, same account and role checks) and delivered in the normal `fd_refresh` cookie. The browser lands on `/auth/google/complete`, which does a normal `POST /auth/refresh`. Rotation and reuse detection apply unchanged.

**The `fd_oauth` cookie** is encrypted and authenticated (JWE `dir` + `A256GCM`, key derived from `OAUTH_STATE_SECRET`), `HttpOnly`, `Secure` in production, path `/api/v1/auth/google`, 10 minutes. It must be `SameSite=Lax`: Google's redirect back is a cross-site top-level navigation, which a `Strict` cookie would not accompany. A link attempt is bound to the user and session that started it, and is refused if that session has ended.

**Account rules**
- Accounts are matched only on Google's `sub` (`user_identities.provider_subject`); email changes at Google don't matter.
- New Google user → PATIENT role and patient profile only, no password, `email_verified_at` set (Google verified it). DOCTOR still requires the application and admin approval; ADMIN is never granted.
- The Google email belongs to an existing account that isn't linked → refused with `GOOGLE_EMAIL_EXISTS`. Nothing is linked automatically: the owner signs in with their password and connects Google under **Sign-in & security** (`/account/security`).
- A Google account linked to another user → `GOOGLE_ALREADY_LINKED`. One Google account per user, one user per Google account (unique constraints).
- ADMIN accounts are password-only: they can't connect Google, and a Google identity can't sign in an account that has the ADMIN role.
- Suspended or disabled accounts are refused exactly as with password sign-in. A suspended doctor signs in as patient (DOCTOR unusable), as with a password.
- Google can be disconnected only when the account also has a password.
- Password login on a Google-only account fails with the same generic `INVALID_CREDENTIALS` and timing as a wrong password.

## Other protections

- **Rate limiting:** `/register`, `/login` and `/refresh` are limited per IP (default 20 per 15 minutes) with standard `RateLimit` headers. Document uploads (30 / 15 min), availability changes (60 / 15 min) and public directory reads (300 / 5 min) have their own limits. Set `TRUST_PROXY` behind a load balancer.
- **Availability:** only the signed-in doctor's own rules and blocks can be changed (ids are always scoped to that doctor, so another doctor's ids are `404`), and only while the profile is verified and active — checked under a row lock on every change, not just at login.
- **CORS:** an explicit origin allow-list with credentials; never `*`. Preflights from other origins are refused.
- **Validation:** Zod schemas with `.strict()` reject unknown fields. Error details never echo submitted values.
- **Headers:** `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, and no `X-Powered-By`.
- **Logs:**
  - Tokens, passwords and request bodies are never logged.
  - Prisma's own error logging is off, because Postgres errors can contain row data.
  - The error handler logs only the class and code of database errors.
- **Audit log:** registration, login, logout, logout-all, role switches, refresh-token reuse, role grants, and every doctor-application save, upload, submission and decision.
- **Private documents:** doctor documents are stored outside the web root, validated by their bytes (PDF/JPEG/PNG, ≤ 5 MB), served only through authenticated endpoints as sandboxed attachments, and never exposed by storage key. Uploads are rate-limited separately.
- **Secrets:** `JWT_ACCESS_SECRET` is required (at least 32 characters) and has no default. The server refuses to start without it.

## Known limitations

- **Rate limiting is per instance.** The store is in memory, so a multi-instance deployment needs a shared store such as Redis.
- **The Google replay guard is per instance** too (an in-memory list of used `state` values). Google itself accepts each authorization code once and the OAuth cookie is single-use, but several API instances would need the used-state list in a shared store.
- **Google-only accounts have no password,** and there is no way yet to add one or to reset one.
- **Two tabs refreshing at once.** Strict rotation means two tabs refreshing with the same cookie can trigger reuse detection and log the user out. The web client should send refreshes through a single queue, or the server could add a short grace window later.
- **No email or phone verification, password reset or MFA yet.** The schema already has `password_reset_tokens` and `*_verified_at` columns.
- **Access tokens can't be revoked individually.** They are re-validated per request, so a logout or suspension takes effect on the very next request.
