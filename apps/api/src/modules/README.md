# API modules

One folder per feature. Each module uses these files where applicable:

```
appointments/
├── appointment.routes.js      Express router: paths + middleware (auth, validation)
├── appointment.controller.js  Thin: parse request → call service → send response
├── appointment.service.js     Business rules; the only layer that decides anything
├── appointment.repository.js  Prisma queries; no business logic
├── appointment.validation.js  Request schemas
└── appointment.constants.js   Enums, limits, status values
```

Request flow: **routes → middleware → controllers → services → repositories → Prisma**.

`health/` is the reference module. Mount new routers in `src/app.js`.
