import * as healthService from './health.service.js';

/** Controllers stay thin: read the request, call a service, send the response. */
export function show(_req, res) {
  res.json(healthService.getHealth());
}
