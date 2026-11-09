const DEFAULT_CODES = Object.freeze({
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  423: 'LOCKED',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
});

/**
 * Error carrying an HTTP status and a stable machine-readable `code`; thrown by services and
 * middleware, rendered by the error middleware as { error: { code, message, details? } }.
 */
export class ApiError extends Error {
  constructor(status, message, details, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.code = code ?? DEFAULT_CODES[status] ?? 'ERROR';
  }

  static badRequest(message = 'Bad request', details, code) {
    return new ApiError(400, message, details, code);
  }

  static unauthorized(message = 'Authentication required', code) {
    return new ApiError(401, message, undefined, code);
  }

  static forbidden(message = 'Not allowed', details, code) {
    return new ApiError(403, message, details, code);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }

  static conflict(message, details, code) {
    return new ApiError(409, message, details, code);
  }

  static locked(message, details) {
    return new ApiError(423, message, details);
  }
}

/** The default error code for an HTTP status (e.g. 404 → NOT_FOUND). */
export const defaultErrorCode = (status) => DEFAULT_CODES[status] ?? 'ERROR';
