import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../../middleware/authenticate.js';
import { authRateLimiter } from '../../middleware/rateLimit.js';
import { requireClientHeader } from '../../middleware/requireClientHeader.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as authController from './auth.controller.js';
import * as googleController from './google.controller.js';
import { changePasswordSchema, googleLinkSchema, googleStartSchema, loginSchema, logoutSchema, refreshSchema, registerSchema, switchRoleSchema } from './auth.validation.js';

/** /api/v1/auth — see docs/api.md for request/response contracts. */
export function createAuthRouter({ rateLimit } = {}) {
  const router = Router();
  const limiter = authRateLimiter(rateLimit);

  router.post('/register', limiter, validate({ body: registerSchema }), asyncHandler(authController.register));
  router.post('/login', limiter, validate({ body: loginSchema }), asyncHandler(authController.login));
  router.post('/refresh', limiter, requireClientHeader, validate({ body: refreshSchema }), asyncHandler(authController.refresh));
  router.post('/logout', requireClientHeader, optionalAuthenticate, validate({ body: logoutSchema }), asyncHandler(authController.logout));
  router.post('/logout-all', authenticate, asyncHandler(authController.logoutAll));
  router.post('/switch-role', authenticate, validate({ body: switchRoleSchema }), asyncHandler(authController.switchRole));
  router.get('/me', authenticate, authController.me);
  // Change password: re-authenticates with the current password; other sessions are revoked.
  router.post('/password', limiter, requireClientHeader, authenticate, validate({ body: changePasswordSchema }), asyncHandler(authController.changePassword));

  // Google sign-in (see docs/auth.md). The callback is reached by a top-level redirect from Google, so it
  // can't carry the client header; it is protected by the one-time state/nonce/PKCE cookie instead.
  router.get('/providers', googleController.providers);
  router.post('/google/start', limiter, requireClientHeader, validate({ body: googleStartSchema }), asyncHandler(googleController.start));
  router.get('/google/callback', limiter, asyncHandler(googleController.callback));
  router.post('/google/link', limiter, requireClientHeader, authenticate, validate({ body: googleLinkSchema }), asyncHandler(googleController.startLink));
  router.delete('/google', requireClientHeader, authenticate, asyncHandler(googleController.disconnect));
  router.get('/methods', authenticate, asyncHandler(googleController.methods));

  return router;
}
