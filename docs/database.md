# Database

- **Engine:** PostgreSQL
- **ORM:** Prisma
- **Schema:** `prisma/schema.prisma`
- **Migrations:** `prisma/migrations/`
- **Seed:** `prisma/seed.js`

## Status

Phase 1 is structure only. The schema declares the generator and the datasource but has **no models yet**. Prisma isn't installed as a dependency yet; it gets added to `apps/api` together with the first model, so we don't ship an unused toolchain.

## Planned entities (Phase 2, to be reviewed)

The Phase 1 UI implies these entities. Each one should be reviewed before it's modelled.

| Entity | Notes from the UI |
|---|---|
| User | Roles: patient, doctor, admin and super admin. Has a preferred language (en/so) and theme. |
| PatientProfile | Gender, date of birth and patient ID (for example PT-10348) |
| DoctorProfile | Specialty, licence, verification status (pending, verified or rejected), fee, languages and location |
| Specialty | A fixed list; drives the filters and the landing page |
| Availability | Weekly slots per doctor, time zone, blocked dates |
| Appointment | Patient, doctor, start time, duration, type (video), status (upcoming, waiting, in session, completed or cancelled) |
| Consultation | Belongs to an appointment. Holds notes, diagnosis and call timing. |
| Prescription | Items made up of medication and dosage; linked to a consultation |
| Payment / Refund | Amount, provider (through the payment adapter), status |
| Message | Consultation chat |
| MedicalRecord / File | Uploaded documents (through the storage adapter) |
| AuditLog | Admin actions |

## Conventions

- Primary keys are `cuid()` strings. Every table has `createdAt` and `updatedAt`.
- Money is stored as integer minor units plus a currency code.
- Times are stored in UTC. Each doctor's time zone is stored separately for slot display.
