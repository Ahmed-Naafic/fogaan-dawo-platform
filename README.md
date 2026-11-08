# Fogaan Dawo App

**Healthcare Without Borders.** A bilingual (English / Somali) telemedicine platform.

This is a monorepo built on npm workspaces:

| Path | What |
|---|---|
| `apps/web` | React + Vite + Tailwind web client: landing, patient, doctor and admin experiences, video consultation, PWA |
| `apps/api` | Node + Express API: health endpoint plus the database services (booking, payments, refunds, ledger, verification, medical history, notes). No HTTP feature routes yet. |
| `prisma/` | PostgreSQL (Neon) schema with 37 models, migrations and the development seed. See [docs/database.md](docs/database.md). |
| `tests/` | `node:test` suites (`unit/`, `integration/`) |
| `design-reference/` | The approved visual specs: `web-light.png`, `web-dark.png`, `mobile-approved.png` |
| `docs/` | `architecture.md`, `database.md`, `api.md`, `deployment-vercel.md` (API on Vercel) |

## Getting started

Requires Node 22.9 or newer.

```bash
npm install
cp .env.example .env     # optional for now; defaults work
npm run dev              # web on http://localhost:5173, API on http://localhost:4000
```

## Commands (run from the repo root)

| Command | Does |
|---|---|
| `npm run dev` | Web and API together, with prefixed output |
| `npm run dev:web` | Web only (Vite) |
| `npm run dev:api` | API only (restarts on change) |
| `npm run build` | Production build of the web app to `apps/web/dist` |
| `npm run preview` | Serves the production build |
| `npm run start:api` | API without watch mode |
| `npm test` | All tests (`test:unit`, `test:integration`) |
| `npm run check:i18n` | Fails if `en.json` and `so.json` keys differ, or if a key used in code is missing |

CI (`.github/workflows/tests.yml`) runs `npm ci`, the i18n check, the tests and the build on every push and pull request.

## Web screens

The landing page is at `/`. The other screens:

- `/login`
- `/patient`
- `/patient/doctors`
- `/doctor`
- `/admin`
- `/consultation/:id`

Add `?lang=so` to any URL for Somali. To switch between the patient, doctor and admin views, use the profile menu.

See [docs/architecture.md](docs/architecture.md) for the folder-by-folder guide.

## Phase status

- **Phase 1 (done):** the visual foundation, built to match `design-reference/`. Its static mock data has since been removed: every dashboard and the landing page now read live figures from the API (see "Dashboards" in `docs/api.md`).
- **Phase 2 (in progress):** the database is implemented (Prisma + Neon); see `docs/database.md`. Next: authentication, the HTTP API, provider payments and realtime features.

Before launch:

- Replace the remaining design images in `apps/web/src/assets/images/` (hero and consultation artwork). They're cropped from the reference renders.
- Have a native medical translator review `apps/web/src/locales/so.json`.
