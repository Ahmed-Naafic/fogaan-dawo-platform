import { AuthErrorCode, CLIENT_HEADER, ClientType } from '../modules/auth/auth.constants.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * CSRF protection for endpoints that act on the refresh cookie (refresh, logout).
 * The browser attaches cookies automatically, but a cross-site page cannot add a custom header without
 * passing a CORS preflight, and our CORS allow-list rejects foreign origins. So a request that carries
 * `X-Fogaan-Client: web|native` was made by our own client.
 */
export function requireClientHeader(req, _res, next) {
  const value = req.get(CLIENT_HEADER);
  if (value === ClientType.web || value === ClientType.native) return next();
  return next(ApiError.forbidden('Missing X-Fogaan-Client header', undefined, AuthErrorCode.csrfHeaderMissing));
}
