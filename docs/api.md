# API

- **Base URL:** `http://localhost:4000/api`. In development the web app calls `/api`, and Vite proxies it.
- **Format:** JSON request and response bodies.
- **Errors:** every error has the shape `{ "error": { "message": string, "details"?: any } }`.

## Implemented

### `GET /api/health`

Reports the API process status.

```json
{ "status": "ok", "service": "fogaan-dawo-api", "uptimeSeconds": 12, "timestamp": "2026-11-03T12:00:00.000Z" }
```

Unknown routes return `404` with the error shape above.

## Planned modules (Phase 2)

These are not implemented. Endpoints will be documented here as each module lands.

`auth` · `users` · `doctors` · `specialties` · `availability` · `appointments` · `consultations` · `prescriptions` · `payments` · `messages` · `records` · `admin` (verification, reports, audit logs)

Each module follows the layering described in `apps/api/src/modules/README.md`.
