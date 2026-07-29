export class ApiError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const errors = {
  notFound: (msg = 'not found') => new ApiError('not_found', msg, 404),
  validation: (msg) => new ApiError('validation', msg, 400),
  conflict: (msg) => new ApiError('conflict', msg, 409),
  unauthorized: (msg = 'unauthorized') => new ApiError('unauthorized', msg, 401),
};

export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  console.error('[error]', err);
  return res.status(500).json({ error: { code: 'internal', message: 'internal server error' } });
}
