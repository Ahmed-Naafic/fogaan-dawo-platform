/** 404 handler for unknown routes: forwards a NOT_FOUND ApiError to the standard error handler. */
import { ApiError } from '../utils/ApiError.js';

/** Final Express handler: unknown routes become a 404 NOT_FOUND error in the standard error shape. */
export function notFound(req, _res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}
