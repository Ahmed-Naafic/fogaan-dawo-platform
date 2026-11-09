import { Router } from 'express';
import { publicRateLimiter } from '../../middleware/rateLimit.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { publicStats } from './dashboard.service.js';

/** GET /api/v1/public/stats — landing-page figures (counts only; no personal data). */
export function createPublicStatsRouter() {
  const router = Router();
  router.get(
    '/',
    publicRateLimiter(),
    asyncHandler(async (_req, res) => {
      res.set('Cache-Control', 'public, max-age=300');
      res.json({ data: await publicStats() });
    }),
  );
  return router;
}
