import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { rateLimiter } from '../../middleware/rateLimit.js';
import { requireClientHeader } from '../../middleware/requireClientHeader.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as controller from './notification.controller.js';
import { idParamsSchema, listQuerySchema, preferencesSchema, readStateSchema, streamQuerySchema, subscriptionSchema, unsubscribeSchema } from './notification.validation.js';

/** /api/v1/notifications — any signed-in user (patient, doctor or admin), own notifications only. */
export function createNotificationRouter() {
  const router = Router();
  const pushLimiter = rateLimiter({ windowMs: 15 * 60_000, limit: 30 });
  router.use(authenticate);

  router.get('/', validate({ query: listQuerySchema }), asyncHandler(controller.list));
  router.get('/unread-count', asyncHandler(controller.unread));
  router.get('/stream', validate({ query: streamQuerySchema }), asyncHandler(controller.stream));
  router.post('/read-all', requireClientHeader, asyncHandler(controller.readAll));
  router.get('/preferences', asyncHandler(controller.getPreferences));
  router.put('/preferences', requireClientHeader, validate({ body: preferencesSchema }), asyncHandler(controller.updatePreferences));
  router.post('/push-subscriptions', pushLimiter, requireClientHeader, validate({ body: subscriptionSchema }), asyncHandler(controller.subscribe));
  router.delete('/push-subscriptions', requireClientHeader, validate({ body: unsubscribeSchema }), asyncHandler(controller.unsubscribe));
  router.patch('/:id', requireClientHeader, validate({ params: idParamsSchema, body: readStateSchema }), asyncHandler(controller.setRead));
  router.delete('/:id', requireClientHeader, validate({ params: idParamsSchema }), asyncHandler(controller.remove));
  return router;
}
