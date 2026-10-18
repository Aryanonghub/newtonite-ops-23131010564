import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/errors';
import { api } from './helpers';

// Every response carries a request id, so a log line and a user's bug report can be matched up.
describe('request ids and error responses', () => {
  it('every response has an X-Request-Id', async () => {
    const res = await api().get('/health').expect(200);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps a well-formed X-Request-Id sent by the caller (e.g. a proxy)', async () => {
    const res = await api().get('/health').set('X-Request-Id', 'abc-123').expect(200);
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('replaces a malformed X-Request-Id instead of echoing it', async () => {
    const res = await api().get('/health').set('X-Request-Id', 'bad id <script>').expect(200);
    expect(res.headers['x-request-id']).not.toContain('<');
  });

  it('a 500 hides the error but returns the request id', () => {
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) };
    errorHandler(new Error('connection string with secrets'), { id: 'req-1' } as never, res as never, () => {});
    expect(res.status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ error: 'Internal server error', requestId: 'req-1' });
  });
});
