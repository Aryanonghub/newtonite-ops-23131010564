import type { ErrorRequestHandler } from 'express';
import { log } from './logger';

// Throw this anywhere in a handler to send a specific HTTP status.
// `extra` lets us attach data, e.g. the latest item on a 409 Conflict.
export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message);
  }
}

// Express 5 passes errors from async handlers here automatically.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...err.extra });
    return;
  }
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }
  log('error', 'unhandled error', { requestId: req.id, error: err instanceof Error ? err.message : String(err), stack: err?.stack });
  // Never leak internals to the client. The request id lets someone report the error and us find the log line.
  res.status(500).json({ error: 'Internal server error', requestId: req.id });
};
