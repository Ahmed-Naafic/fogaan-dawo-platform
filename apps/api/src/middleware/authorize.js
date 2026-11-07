import { AuthErrorCode } from '../modules/auth/auth.constants.js';
import { roleHasPermission } from '../modules/auth/auth.permissions.js';
import { assertAccountActive } from '../modules/auth/auth.service.js';
import { ApiError } from '../utils/ApiError.js';

/** Use after authenticate(). All checks run on the server; the frontend only hides what these deny. */

const requireAuth = (req) => {
  if (!req.auth) throw ApiError.unauthorized('Authentication required', AuthErrorCode.tokenMissing);
  return req.auth;
};

/** The session's active role must be one of `roles`. */
export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    try {
      const auth = requireAuth(req);
      if (!roles.includes(auth.activeRole)) {
        throw ApiError.forbidden(`This action requires the ${roles.join(' or ')} role`, undefined, AuthErrorCode.roleRequired);
      }
      next();
    } catch (error) {
      next(error);
    }
  };

/** The session's active role must grant `permission` (see auth.permissions.js). */
export const requirePermission = (permission) => (req, _res, next) => {
  try {
    const auth = requireAuth(req);
    if (!roleHasPermission(auth.activeRole, permission)) {
      throw ApiError.forbidden('You do not have permission to perform this action', { permission }, AuthErrorCode.permissionRequired);
    }
    next();
  } catch (error) {
    next(error);
  }
};

/** Explicit account-status gate (authenticate already applies it; exported for routes that load users differently). */
export const requireActiveAccount = (req, _res, next) => {
  try {
    assertAccountActive(requireAuth(req).user);
    next();
  } catch (error) {
    next(error);
  }
};
