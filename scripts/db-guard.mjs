// Safety gate run before every db:* command. Never prints credentials (host is masked).
//
//   node scripts/db-guard.mjs            → migrate / status / studio
//   node scripts/db-guard.mjs seed       → seeding (development data)
//
// DATABASE_ENV must say which database .env points at: "development" or "production".
//   * development: allowed.
//   * production:  allowed only with ALLOW_PRODUCTION_DB=true set for that single command
//                  (never store it in .env). Seeding is always refused on production.
const fail = (msg) => {
  console.error(`\n[db-guard] REFUSED: ${msg}\n`);
  process.exit(1);
};

const mode = process.argv[2] === 'seed' ? 'seed' : 'migrate';
const { DATABASE_ENV, DATABASE_URL, DIRECT_URL, ALLOW_PRODUCTION_DB } = process.env;

if (DATABASE_ENV !== 'development' && DATABASE_ENV !== 'production') {
  fail('DATABASE_ENV must be "development" or "production" in .env so the target database is explicit.');
}

for (const [name, value] of Object.entries({ DATABASE_URL, DIRECT_URL })) {
  if (!value) fail(`${name} is not set. Copy .env.example to .env and paste the Neon connection strings.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} is not a valid URL.`);
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) fail(`${name} must be a postgresql:// URL.`);
  if (DATABASE_ENV === 'development' && (/prod/i.test(url.hostname) || /prod/i.test(url.pathname))) {
    fail(`${name} looks like a production database (host or name contains "prod") but DATABASE_ENV is "development".`);
  }
}

if (DATABASE_ENV === 'production') {
  if (mode === 'seed') fail('Seeding creates development test accounts and placeholder settings; it never runs against production.');
  if (ALLOW_PRODUCTION_DB !== 'true') {
    fail('DATABASE_ENV is "production". Re-run this single command with ALLOW_PRODUCTION_DB=true to confirm you intend to touch production.');
  }
}

const host = new URL(DIRECT_URL).hostname.replace(/^([^.]{6})[^.]*/, '$1…');
console.log(`[db-guard] OK — ${DATABASE_ENV} target ${host}${DATABASE_ENV === 'production' ? ' (production confirmed for this command)' : ''}`);
