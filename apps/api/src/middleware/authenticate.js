import { prisma } from '../config/database.js';
import { AuthErrorCode } from '../modules/auth/auth.constants.js';
import { resolveAuthContext } from '../modules/auth/auth.service.js';
import { verifyAccessToken } from '../modules/auth/auth.tokens.js';
import { ApiError } from '../utils/ApiError.js';

function bearerToken(req) {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/**
 * Requires a valid access token AND re-validates it against the database (session live, account
 * ACTIVE, active role still assigned/usable). Sets req.auth = { user, sessionId, activeRole, roles, permissions }.
 * A valid JWT alone is never treated as proof the account is still authorized.
 */
export async function authenticate(req, _res, next) {
  try {
    const token = bearerToken(req);
    if (!token) throw ApiError.unauthorized('Authentication required', AuthErrorCode.tokenMissing);
    const claims = await verifyAccessToken(token);
    req.auth = await resolveAuthContext(prisma, claims);
    next();
  } catch (error) {
    next(error);
  }
}

/** Like authenticate, but continues anonymously when no Authorization header is sent. */
export async function optionalAuthenticate(req, res, next) {
  if (!bearerToken(req)) return next();
  return authenticate(req, res, next);
}
