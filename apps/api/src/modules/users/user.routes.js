import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { requirePermission, requireRole } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { Permission } from '../auth/auth.permissions.js';
import * as userController from './user.controller.js';
import { assignRoleSchema, userIdParamsSchema } from './user.validation.js';

/** /api/v1/admin/users — administrator-only user management (RBAC foundation). */
export function createAdminUserRouter() {
  const router = Router();
  router.use(authenticate, requireRole('ADMIN'), requirePermission(Permission.rolesAssign));
  router.post('/:userId/roles', validate({ params: userIdParamsSchema, body: assignRoleSchema }), asyncHandler(userController.assignRole));
  return router;
}
