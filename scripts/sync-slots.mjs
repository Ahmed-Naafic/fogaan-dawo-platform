// Daily job: publishes each verified doctor's slots for the rolling window (SLOT_HORIZON_DAYS) and
// withdraws unbooked slots of doctors who are no longer verified + active. Idempotent; never touches
// held or booked slots. Run through `npm run slots:sync` (db-guard checks the target database first).
const { syncAllDoctorSlots } = await import('../apps/api/src/modules/availability/availability.service.js');
const { prisma } = await import('../apps/api/src/config/database.js');
try {
  const totals = await syncAllDoctorSlots();
  console.log(`[slots:sync] doctors=${totals.doctors} created=${totals.created} removed=${totals.removed}`);
} finally {
  await prisma.$disconnect();
}
