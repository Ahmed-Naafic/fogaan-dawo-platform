import { createApp } from './app.js';
import { env } from './config/env.js';

const server = createApp().listen(env.port, () => {
  console.log(`[api] listening on http://localhost:${env.port} (${env.nodeEnv})`);
});

const shutdown = (signal) => {
  console.log(`[api] ${signal} received, closing`);
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
