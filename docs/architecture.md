# Architecture

Fogaan Dawo is an npm-workspaces monorepo with two apps and shared tooling at the root.

```
apps/web     React 18 + Vite + Tailwind 3.4 — patient, doctor and admin experiences (PWA)
apps/api     Node + Express — REST API and (later) realtime sockets
prisma/      Database schema, migrations and seed (PostgreSQL on Neon, Prisma 6), see database.md
tests/       node:test suites — unit/ and integration/
scripts/     Dev orchestration and repository checks
```

A single `package-lock.json` at the root pins the dependencies for both apps. Each app lists its own dependencies in its own `package.json`.

## Web (`apps/web/src`)

| Folder | Responsibility |
|---|---|
| `app/` | `App.jsx` (shell concerns such as scroll restoration), `router.jsx` (every route), `providers.jsx` (router, theme, i18n and toasts), `navigation.js` (sidebar and tab config per role) |
| `components/ui/` | Design-system primitives with no app knowledge: Button, Card, Input, Badge, Avatar, IconTile, StatCard, Tabs, Toggle, Toast, charts |
| `components/shared/` | App-aware building blocks: Logo, LanguageSwitcher, ThemeToggle, Flag, Rating, SpecialtyIcon, ComingSoonPage |
| `components/layout/` | Frames: AppShell, Sidebar, MobileTabBar, PageHeader, PublicHeader |
| `features/<name>/` | One folder per product area, with `pages/`, `components/`, `layouts/` and `services/` as needed |
| `hooks/` | Reusable React hooks (`useCallTimer`, `useClickOutside`) |
| `lib/` | Framework-free helpers (`cn`, `format`) plus the theme and i18n contexts |
| `services/` | The data access layer. Pages read data only from here. |
| `mock/` | Phase 1 static data behind `services/` |
| `locales/` | `en.json` and `so.json`. Both must have identical keys; CI enforces this. |
| `styles/` | `tokens.css` (light and dark design tokens), `globals.css` |

Feature map:

- `landing`: the public site.
- `auth`: login and register.
- `patient`, `doctor`, `admin`: role dashboards and role layouts.
- `doctors`: discovery, the doctor cards, and the **doctor application** (`pages/DoctorApplicationPage.jsx` at `/patient/doctor-application`, shared `components/ApplicationParts.jsx`, pure form logic in `doctorApplicationForm.js`, API calls in `services/doctorApplicationApi.js`).
- `admin`: also **doctor verification** — `/admin/verification` (Pending / Verified / Rejected tabs) and `/admin/verification/:doctorId` (review, documents, approve or reject with reason); API calls in `services/verificationApi.js`. The sidebar's pending badge comes from the real count.
- `doctor`: the dashboard's `ProfessionalProfileCard` shows the verified profile from `GET /api/v1/doctors/me`.
- `availability`: `/doctor/availability` — Weekly Schedule / Block Dates tabs (approved mobile design) and a weekly calendar of published slots; pure form logic in `availabilityForm.js`.
- `doctors` (directory): `/doctors` and `/doctors/:doctorId` are **public** (no login, `PublicDirectoryLayout` with the landing header); the same pages run inside the patient shell at `/patient/doctors…`. `SlotPicker` (in `appointments/components`) shows real open slots and is shared by the profile page and `BookingSheet`; confirming a time does not book yet.
- Time display: `lib/timezone.js` formats UTC instants in an explicit zone — the viewer's (`Intl` browser zone) or, on request, the doctor's.
- `appointments`: booking (the slot picker).
- `video`: the call stage and controls.
- `consultations`: the in-call panel (notes, prescription draft, chat, files).
- `availability`, `payments`, `messaging`, `prescriptions`, `analytics`: reserved for Phase 2.

PWA: `public/manifest.webmanifest` (name, icons, shortcuts, standalone display) and `public/sw.js`, an app-shell service worker registered only in production builds (`main.jsx`). It caches the shell and hashed assets for offline start, uses network-first for page loads, and never caches or intercepts `/api/*`.

Theming works through CSS variables in `tokens.css`. Tailwind colour utilities resolve to those variables, so switching the `dark` class on `<html>` re-themes the entire app.

## API (`apps/api/src`)

```
config/      env access (validated, frozen)
middleware/  cross-cutting: error handler, 404, (later) auth, validation, rate limits
modules/     feature modules — see modules/README.md
adapters/    payment/, sms/, storage/ — vendor integrations behind stable interfaces
sockets/     realtime (signalling, chat) — Phase 2
utils/       small shared helpers (ApiError)
app.js       builds the Express app (no listen) — used by tests
server.js    process entry: listen + graceful shutdown
```

Request flow: **routes → middleware → controllers → services → repositories → Prisma**.

- **Controllers** are thin. They read the request, call one service and shape the response.
- **Services** hold all business rules.
- **Repositories** are the only code that talks to Prisma.
- **Adapters** isolate third-party providers, such as mobile money, SMS and object storage, so each one can be swapped without touching services.
  - `adapters/storage/privateStorage.js` is the current document store: local disk under `STORAGE_DIR` (default `<repo>/storage/private`, git-ignored). Keys are generated server-side (`doctor-documents/<doctorId>/<uuid>.<ext>`), validated against a strict pattern and a root-escape check, and written with `wx` so nothing is overwritten. Production should swap in a private object-storage bucket behind the same three functions (`put`, `get`, `remove`).

Availability lives in `modules/availability/`: `availability.slots.js` (pure slot planning and reconciliation, unit-tested), `availability.service.js` (rules, blocks, slot sync under a doctor row lock), `availability.repository.js`, `availability.validation.js`. `utils/timezone.js` does all IANA-zone ⇄ UTC conversion with `Intl` (no server-local time). The public directory is `modules/doctors/doctorDirectory.*`.

Doctor management lives in `modules/doctors/`: `doctorApplication.*` (applicant: validation, presenter, service, controller), `doctorVerification.*` (admin decisions), `doctor.routes.js`, and `utils/fileType.js` (magic-byte detection, safe display names).

## Environment

The repo root has one `.env` file; `.env.example` is the template. The API loads it through Node's `--env-file-if-exists`, and the web app reads it through Vite's `envDir`. Only `VITE_*` values reach the browser.

In development, Vite proxies `/api/*` to the API (`PORT`, default 4000).
