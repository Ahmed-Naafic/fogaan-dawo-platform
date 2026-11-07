import { Router } from 'express';
import { cronConfigProblem, isValidCronAuthorization } from '../../config/cron.js';
import { ApiError } from '../../utils/ApiError.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { JOBS, runJobs } from './jobs.service.js';

/**
 * GET /api/internal/jobs/tick   — all jobs (holds → reminders → notifications)
 * GET /api/internal/jobs/:job   — one job: expire-holds | reminders | notifications
 * GET because Vercel Cron issues GET requests. Requires `Authorization: Bearer <CRON_SECRET>`.
 */
export function createJobsRouter() {
  const router = Router();

  router.use((req, _res, next) => {
    if (cronConfigProblem()) return next(new ApiError(503, 'Scheduled jobs are not configured', undefined, 'JOBS_DISABLED'));
    if (!isValidCronAuthorization(req.get('authorization'))) return next(ApiError.unauthorized('Invalid job credentials'));
    return next();
  });

  const respond = async (names, res) => {
    const outcome = await runJobs(names);
    res.status(outcome.ok ? 200 : 500).json(outcome);
  };

  router.get('/tick', asyncHandler((_req, res) => respond(['expire-holds', 'reminders', 'notifications'], res)));
  router.get(
    '/:job',
    asyncHandler((req, res) => {
      if (!Object.hasOwn(JOBS, req.params.job)) throw ApiError.notFound('Unknown job');
      return respond([req.params.job], res);
    }),
  );

  return router;
}
