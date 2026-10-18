import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, app, auth, createItem, seedFixture, type Fixture } from './helpers';

// Live updates: GET /items/:id/live streams "change" events. A real HTTP server is used (not
// Supertest) so the test can read the stream while it is still open.
// vitest.config sets LIVE_POLL_MS=100 and LIVE_STREAM_SECONDS=2.
describe('GET /items/:id/live', () => {
  let f: Fixture;
  let server: Server;
  let base: string;
  beforeAll(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));
  beforeEach(async () => {
    f = await seedFixture();
  });

  // Reads the stream until it ends (or `until` returns true), returning everything received.
  async function read(path: string, token: string, until: (text: string) => boolean = () => false) {
    const res = await fetch(base + path, { headers: auth(token) });
    let text = '';
    if (!res.body) return { status: res.status, text };
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += value;
      if (until(text)) { await reader.cancel(); break; }
    }
    return { status: res.status, text, type: res.headers.get('content-type') };
  }

  it('sends "change" when someone else changes the item', async () => {
    const item = await createItem(f.alice, f.payments);
    const stream = read(`/items/${item.id}/live`, f.alice.token, (t) => t.includes('event: change'));

    await new Promise((resolve) => setTimeout(resolve, 300)); // let the stream take its first snapshot
    await api().post(`/items/${item.id}/claim`).set(auth(f.bob.token)).expect(200);
    const { status, text, type } = await stream;

    expect(status).toBe(200);
    expect(type).toContain('text/event-stream');
    expect(text).toMatch(/event: change\ndata: \{"version":2,/);
  });

  it('a comment also counts as a change (it adds a history event)', async () => {
    const item = await createItem(f.alice, f.payments);
    const stream = read(`/items/${item.id}/live`, f.alice.token, (t) => t.includes('event: change'));

    await new Promise((resolve) => setTimeout(resolve, 300));
    await api().post(`/items/${item.id}/comments`).set(auth(f.bob.token)).send({ body: 'On it' }).expect(201);

    expect((await stream).text).toContain('event: change');
  });

  it('sends nothing when nothing changes, and ends after the stream time limit', async () => {
    const item = await createItem(f.alice, f.payments);
    const started = Date.now();

    const { text } = await read(`/items/${item.id}/live`, f.alice.token);

    expect(text).not.toContain('event: change');
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900); // LIVE_STREAM_SECONDS=2
  });

  it('is 404 for someone outside the team, like every other read', async () => {
    const item = await createItem(f.alice, f.payments);
    const { status } = await read(`/items/${item.id}/live`, f.sam.token);
    expect(status).toBe(404);
  });
});
