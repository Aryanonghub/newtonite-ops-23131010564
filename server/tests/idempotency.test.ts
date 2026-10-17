import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { api, auth, seedFixture, type Fixture } from './helpers';

// Critical behaviour 3: idempotent create with the Idempotency-Key header.
describe('POST /items idempotency', () => {
  let f: Fixture;
  const body = { title: 'Payout stuck', type: 'payment', priority: 'urgent', team_id: 0 };
  const countItems = async () => (await pool.query('SELECT count(*)::int AS n FROM work_items')).rows[0].n;

  beforeEach(async () => {
    f = await seedFixture();
    body.team_id = f.payments;
  });

  const create = (key: string, data: object = body, token = f.alice.token) =>
    api().post('/items').set(auth(token)).set('Idempotency-Key', key).send(data);

  it('same key twice creates exactly one item and returns the same response', async () => {
    const first = await create('key-1');
    const second = await create('key-1');

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.text).toBe(first.text); // byte-for-byte the same body
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(await countItems()).toBe(1);
  });

  it('same key with a different request body returns 422 and creates nothing new', async () => {
    await create('key-1').expect(201);

    const res = await create('key-1', { ...body, title: 'Something else' });

    expect(res.status).toBe(422);
    expect(await countItems()).toBe(1);
  });

  it('parallel requests with the same key still create exactly one item', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => create('key-race')));

    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await countItems()).toBe(1);
  });

  it('keys are per user: the same key from two users creates two items', async () => {
    await create('shared-key', body, f.alice.token).expect(201);
    await create('shared-key', body, f.bob.token).expect(201);

    expect(await countItems()).toBe(2);
  });

  it('a failed request does not use up the key (its transaction was rolled back)', async () => {
    // Alice is not in Support, so this fails...
    await create('key-1', { ...body, team_id: f.support }).expect(404);
    // ...and the same key can be used for a real request afterwards.
    await create('key-1').expect(201);
  });

  it('requires the Idempotency-Key header', async () => {
    const res = await api().post('/items').set(auth(f.alice.token)).send(body);

    expect(res.status).toBe(400);
    expect(await countItems()).toBe(0);
  });
});
