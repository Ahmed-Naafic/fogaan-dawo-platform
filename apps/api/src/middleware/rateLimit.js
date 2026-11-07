import { rateLimit } from 'express-rate-limit';
import { getAuthRateLimitConfig } from '../config/auth.js';

/**
 * Rate limiter for authentication endpoints (per client IP; in-memory store — use a shared store
 * such as Redis when running more than one API instance). Responds with the standard error shape.
 */
export function authRateLimiter(overrides = {}) {
  const config = getAuthRateLimitConfig();
  return rateLimit({
    windowMs: overrides.windowMs ?? config.windowMs,
    limit: overrides.limit ?? config.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
      res.status(options.statusCode).json({
        error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again later.' },
      });
    },
  });
}

/** Generic per-IP limiter with the standard error shape (used for public reads and availability writes). */
export function rateLimiter({ windowMs, limit, message = 'Too many requests. Please wait and try again later.' }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
      res.status(options.statusCode).json({ error: { code: 'RATE_LIMITED', message } });
    },
  });
}

const envInt = (name, fallback) => Number.parseInt(process.env[name] ?? `${fallback}`, 10);

/** Public directory reads: 300 per 5 minutes per IP by default (PUBLIC_RATE_LIMIT_MAX). */
export const publicRateLimiter = () => rateLimiter({ windowMs: 5 * 60_000, limit: envInt('PUBLIC_RATE_LIMIT_MAX', 300) });

/** Availability changes: 60 per 15 minutes per IP by default (AVAILABILITY_RATE_LIMIT_MAX). */
export const availabilityRateLimiter = () => rateLimiter({ windowMs: 15 * 60_000, limit: envInt('AVAILABILITY_RATE_LIMIT_MAX', 60), message: 'Too many changes. Please wait and try again later.' });

/** Booking changes (reserve, cancel, reschedule): 30 per 15 minutes per IP by default (BOOKING_RATE_LIMIT_MAX). */
export const bookingRateLimiter = () => rateLimiter({ windowMs: 15 * 60_000, limit: envInt('BOOKING_RATE_LIMIT_MAX', 30), message: 'Too many booking requests. Please wait and try again later.' });

/** Document uploads: 30 per 15 minutes per client IP (each upload stores a new, never-overwritten version). */
export function uploadRateLimiter(overrides = {}) {
  return rateLimit({
    windowMs: overrides.windowMs ?? 15 * 60_000,
    limit: overrides.limit ?? Number.parseInt(process.env.UPLOAD_RATE_LIMIT_MAX ?? '30', 10),
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res, _next, options) => {
      res.status(options.statusCode).json({ error: { code: 'RATE_LIMITED', message: 'Too many uploads. Please wait and try again later.' } });
    },
  });
}
