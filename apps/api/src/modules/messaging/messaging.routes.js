import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission } from '../../middleware/authorize.js';
import { rateLimiter } from '../../middleware/rateLimit.js';
import { requireClientHeader } from '../../middleware/requireClientHeader.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { Permission } from '../auth/auth.permissions.js';
import * as service from './messaging.service.js';

const envInt = (name, fallback) => Number.parseInt(process.env[name] ?? `${fallback}`, 10);

const params = z.object({ appointmentId: z.uuid() }).strict();
const pageQuery = z.object({ before: z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()) }).strict();
const sendBody = z.object({ body: z.string().trim().min(1, 'Write a message').max(service.MAX_BODY, `At most ${service.MAX_BODY} characters`) }).strict();
const emptyBody = z.object({}).strict();

const noStore = (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
};

/**
 * /api/v1/messages — patient–doctor conversations (PATIENT or DOCTOR role, messages:own). The service
 * checks on every call that the viewer is a participant of a paid appointment.
 */
export function createMessagingRouter() {
  const router = Router();
  router.use(authenticate, requirePermission(Permission.ownMessages), noStore);
  const send = rateLimiter({ windowMs: 60_000, limit: envInt('MESSAGE_RATE_LIMIT_MAX', 30), message: 'You are sending messages too quickly. Please wait a moment.' });
  router.get('/conversations', asyncHandler(async (req, res) => res.json({ data: await service.listConversations(req.auth) })));
  router.get('/unread-count', asyncHandler(async (req, res) => res.json({ data: await service.unreadCount(req.auth) })));
  router.get('/conversations/:appointmentId', validate({ params, query: pageQuery }), asyncHandler(async (req, res) => res.json({ data: await service.getConversation(req.auth, req.params.appointmentId, req.validatedQuery) })));
  router.post(
    '/conversations/:appointmentId/messages',
    send,
    requireClientHeader,
    validate({ params, body: sendBody }),
    asyncHandler(async (req, res) => res.status(201).json({ data: await service.sendMessage(req.auth, req.params.appointmentId, req.body) })),
  );
  router.post('/conversations/:appointmentId/read', requireClientHeader, validate({ params, body: emptyBody }), asyncHandler(async (req, res) => res.json({ data: await service.markRead(req.auth, req.params.appointmentId) })));
  return router;
}
