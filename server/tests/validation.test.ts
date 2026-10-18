import { beforeEach, describe, expect, it } from 'vitest';
import { api, auth, createItem, seedFixture, type Fixture } from './helpers';

// Bad input must get a clear 4xx, never a 500. Each case here used to reach Postgres or Express
// and fail there with "Internal server error".
describe('input validation (no 500s on bad input)', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await seedFixture();
  });
  const TOO_BIG = '99999999999'; // larger than a Postgres INT

  it('an id too large for the database is 404, not 500', async () => {
    await api().get(`/items/${TOO_BIG}`).set(auth(f.alice.token)).expect(404);
    await api().post(`/items/${TOO_BIG}/claim`).set(auth(f.alice.token)).expect(404);
  });

  it('list filters and cursor too large for the database are 400', async () => {
    await api().get(`/items?team=${TOO_BIG}`).set(auth(f.alice.token)).expect(400);
    await api().get(`/items?assignee=${TOO_BIG}`).set(auth(f.alice.token)).expect(400);
    await api().get(`/items?cursor=${Buffer.from(TOO_BIG).toString('base64url')}`).set(auth(f.alice.token)).expect(400);
  });

  it('a version or team_id too large for the database is 400', async () => {
    const item = await createItem(f.alice, f.payments);
    await api().post(`/items/${item.id}/transition`).set(auth(f.alice.token))
      .send({ to: 'closed', version: Number(TOO_BIG) }).expect(400);
    await api().post('/items').set(auth(f.alice.token)).set('Idempotency-Key', 'big-team')
      .send({ title: 't', type: 'task', priority: 'low', team_id: Number(TOO_BIG) }).expect(400);
  });

  it('an impossible calendar date is 400 on create and on edit', async () => {
    const create = await api().post('/items').set(auth(f.alice.token)).set('Idempotency-Key', 'bad-date')
      .send({ title: 't', type: 'task', priority: 'low', team_id: f.payments, due_date: '2026-02-30' });
    expect(create.status).toBe(400);
    expect(create.body.error).toMatch(/due_date: is not a real date/);

    const item = await createItem(f.alice, f.payments);
    await api().patch(`/items/${item.id}`).set(auth(f.alice.token)).send({ version: 1, due_date: '2026-13-45' }).expect(400);
    await api().patch(`/items/${item.id}`).set(auth(f.alice.token)).send({ version: 1, due_date: '2028-02-29' }).expect(200); // leap day is fine
  });

  it('a body over the 100 kB limit is 413', async () => {
    const item = await createItem(f.alice, f.payments);
    const res = await api().post(`/items/${item.id}/comments`).set(auth(f.alice.token))
      .send({ body: 'a'.repeat(120_000) });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('Request body too large');
  });
});
