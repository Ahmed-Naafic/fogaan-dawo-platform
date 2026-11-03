/** Error carrying an HTTP status; thrown by services, rendered by the error middleware. */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }

  static badRequest(message = 'Bad request', details) {
    return new ApiError(400, message, details);
  }
}
