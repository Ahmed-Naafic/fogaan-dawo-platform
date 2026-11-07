import { ApiError } from '../utils/ApiError.js';

/**
 * Validates and normalises req.body / req.params / req.query with Zod schemas.
 * Error details list field paths and messages only — submitted values (e.g. passwords) are never echoed.
 */
export function validate(schemas) {
  return (req, _res, next) => {
    for (const part of ['params', 'query', 'body']) {
      if (!schemas[part]) continue;
      const result = schemas[part].safeParse(req[part] ?? {});
      if (!result.success) {
        const issues = result.error.issues.map((i) => ({ path: i.path.join('.') || part, message: i.message }));
        return next(ApiError.badRequest('Request validation failed', issues, 'VALIDATION_ERROR'));
      }
      if (part === 'query') req.validatedQuery = result.data; // req.query is read-only in Express 5-style routers
      else req[part] = result.data;
    }
    return next();
  };
}
