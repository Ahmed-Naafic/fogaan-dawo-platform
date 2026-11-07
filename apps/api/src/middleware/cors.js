import { env } from '../config/env.js';

const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Fogaan-Client, X-File-Name, Idempotency-Key';
const ALLOWED_METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';

/**
 * CORS with an explicit origin allow-list (CORS_ORIGIN, comma-separated). Credentials are allowed so the
 * browser can send the HTTP-only refresh cookie; that is only safe because origins are never wildcarded.
 * Requests from other origins get no CORS headers, so browsers block them.
 */
export function cors(allowedOrigins = env.corsOrigins) {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    const origin = req.get('origin');
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
      res.setHeader('Access-Control-Max-Age', '600');
    }
    res.append('Vary', 'Origin');
    if (req.method === 'OPTIONS') return res.sendStatus(origin && allowed.has(origin) ? 204 : 403);
    return next();
  };
}
