/** Central, validated access to environment variables. Import this instead of reading process.env. */
const toInt = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: toInt(process.env.PORT, 4000),
  // Comma-separated allow-list of browser origins that may call the API with credentials.
  corsOrigins: (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  // Number of reverse proxies in front of the API (for correct client IPs in rate limiting); 0 = none.
  trustProxy: toInt(process.env.TRUST_PROXY, 0),
  databaseUrl: process.env.DATABASE_URL ?? '',
});

export const isProduction = env.nodeEnv === 'production';
