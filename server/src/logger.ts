import crypto from 'node:crypto';
import type { RequestHandler } from 'express';

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

// One JSON object per line, so logs can be filtered by field, e.g. every line for one requestId.
// The tests set LOG_LEVEL=silent to keep their output clean.
export function log(level: 'info' | 'warn' | 'error', msg: string, fields: Record<string, unknown> = {}) {
  if (process.env.LOG_LEVEL === 'silent') return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

// Gives every request an id (or keeps a well-formed X-Request-Id from the caller, e.g. a proxy),
// returns it in the X-Request-Id response header, and logs one line when the response is sent.
// The path is logged without the query string, so search terms are not written to the logs.
export const requestLogger: RequestHandler = (req, res, next) => {
  const incoming = req.header('X-Request-Id');
  req.id = incoming && /^[\w-]{1,100}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    log(res.statusCode >= 500 ? 'error' : 'info', 'request', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Number((process.hrtime.bigint() - start) / 1_000_000n),
      userId: req.user?.id,
    });
  });
  next();
};
