import express from 'express';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import healthRoutes from './modules/health/health.routes.js';

/**
 * Builds the Express app without listening, so tests can mount it on an ephemeral port.
 * Request flow: routes → middleware → controllers → services → repositories → Prisma.
 */
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', env.corsOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Feature modules mount here, e.g. app.use('/api/appointments', appointmentRoutes);
  app.use('/api/health', healthRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
