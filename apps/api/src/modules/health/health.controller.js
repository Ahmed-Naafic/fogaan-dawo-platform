import * as healthService from './health.service.js';

/** Controllers stay thin: read the request, call a service, send the response. */
export function show(_req, res) {
  res.json(healthService.getHealth());
}

/** Readiness: 200 when configuration and database are usable, 503 otherwise. */
export async function ready(_req, res, next) {
  try {
    const result = await healthService.getReadiness();
    res.status(result.status === 'ready' ? 200 : 503).json(result);
  } catch (error) {
    next(error);
  }
}
