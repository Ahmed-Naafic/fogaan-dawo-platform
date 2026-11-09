// Creates or verifies the PRIVATE buckets (fd-verification, fd-photos, fd-prescriptions, fd-medical,
// fd-staging) with size/type limits in the DEVELOPMENT Supabase project. Prints bucket names only.
// Refuses unless DATABASE_ENV=development and STORAGE_DRIVER=supabase (production storage is configured
// separately, with approval).
const { storageConfigProblem, storageDescription } = await import('../apps/api/src/adapters/storage/privateStorage.js');
if (process.env.DATABASE_ENV !== 'development') {
  console.error('[storage] refusing: this script only configures the development project (DATABASE_ENV=development).');
  process.exit(1);
}
if (process.env.STORAGE_DRIVER !== 'supabase') {
  console.error('[storage] set STORAGE_DRIVER=supabase (with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) in .env.development first.');
  process.exit(1);
}
const problem = storageConfigProblem();
if (problem) {
  console.error(`[storage] ${problem}`);
  process.exit(1);
}
const { ensureBuckets } = await import('../apps/api/src/adapters/storage/supabaseDriver.js');
for (const r of await ensureBuckets()) console.log(`[storage] ${r.id}: ${r.action}`);
console.log(`[storage] ${storageDescription()} ready.`);
