// Deletes abandoned staging uploads older than 24 hours (unvalidated files are never kept longer).
// Usage: npm run storage:cleanup-staging   (uses STORAGE_DRIVER from the environment; prints counts only)
// On Vercel, schedule it with a Cron Job calling an equivalent protected endpoint, or run it from a worker.
const { cleanupStaging, storageConfigProblem, storageDescription } = await import('../apps/api/src/adapters/storage/privateStorage.js');
const problem = storageConfigProblem();
if (problem) {
  console.error(`[storage] ${problem}`);
  process.exit(1);
}
const result = await cleanupStaging();
console.log(`[storage] ${storageDescription()}: removed ${result.removed} abandoned staging upload(s) (checked ${result.checked}).`);
