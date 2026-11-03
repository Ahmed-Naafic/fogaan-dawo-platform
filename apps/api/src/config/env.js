/** Central, validated access to environment variables. Import this instead of reading process.env. */
const toInt = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

export const env = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: toInt(process.env.PORT, 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL ?? '',
});

export const isProduction = env.nodeEnv === 'production';
