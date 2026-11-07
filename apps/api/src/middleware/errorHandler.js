import { isProduction } from '../config/env.js';
import { defaultErrorCode } from '../utils/ApiError.js';

/**
 * Renders every error as { error: { code, message, details? } }.
 * Never logs request bodies, tokens or passwords; 5xx errors log the error object only.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
export function errorHandler(err, _req, res, _next) {
  // body-parser: malformed JSON or oversized payload
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } });
  }

  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  // A deliberate 503 (e.g. Google sign-in not configured) is an expected answer, not a server fault.
  const intentional = status === 503 && err.name === 'ApiError';
  if (status >= 500 && !intentional) {
    // Database errors can embed row data (PII, password hashes) in their message: log class + code only.
    const isDbError = typeof err.name === 'string' && err.name.startsWith('PrismaClient');
    console.error(isDbError ? `[api] ${err.name}${err.code ? ` ${err.code}` : ''}` : `[api] ${err.name}: ${err.message}`);
  }
  res.status(status).json({
    error: {
      code: err.code && typeof err.code === 'string' && (status < 500 || intentional) ? err.code : defaultErrorCode(status),
      message: status >= 500 && !intentional && isProduction ? 'Internal server error' : err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  });
}
