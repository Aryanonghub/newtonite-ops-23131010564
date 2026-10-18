import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { api, auth, createItem, dbEvents, dbItem, seedFixture, type Fixture } from './helpers';

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

// Retries of the other writes: a lost response must not turn a success into a 409, or post twice.
describe('idempotent claim, transition and comment', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await seedFixture();
  });
  const newItem = () => createItem(f.alice, f.payments);

  it('a retried claim replays its 200 instead of a 409', async () => {
    const item = await newItem();
    const claim = () => api().post(`/items/${item.id}/claim`).set(auth(f.alice.token)).set('Idempotency-Key', 'claim-1');

    const first = await claim().expect(200);
    const retry = await claim();

    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);
    expect((await dbEvents(item.id)).filter((e) => e.kind === 'assignee_changed')).toHaveLength(1);
  });

  it('without a key, a second claim is a new request and gets 409', async () => {
    const item = await newItem();
    await api().post(`/items/${item.id}/claim`).set(auth(f.alice.token)).expect(200);
    await api().post(`/items/${item.id}/claim`).set(auth(f.alice.token)).expect(409);
  });

  it('a retried transition replays its 200 and moves the item once', async () => {
    const item = await newItem();
    await api().post(`/items/${item.id}/claim`).set(auth(f.alice.token)).expect(200);
    const submit = () => api().post(`/items/${item.id}/transition`).set(auth(f.alice.token))
      .set('Idempotency-Key', 'submit-1').send({ to: 'awaiting_approval', version: 2 });

    await submit().expect(200);
    const retry = await submit(); // version 2 is stale now, but the key is checked first

    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(await dbItem(item.id)).toMatchObject({ status: 'awaiting_approval', version: 3 });
  });

  it('a failed write stores nothing, so the same key can be retried after fixing the cause', async () => {
    const item = await newItem();
    await api().post(`/items/${item.id}/claim`).set(auth(f.alice.token)).expect(200);
    const move = (version: number) => api().post(`/items/${item.id}/transition`).set(auth(f.alice.token))
      .set('Idempotency-Key', 'move-1').send({ to: 'awaiting_approval', version });

    await move(1).expect(409); // stale version: rolled back, key not stored
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM idempotency_keys WHERE key = 'move-1'");
    expect(rows[0].n).toBe(0);
  });

  it('a double-submitted comment is posted once', async () => {
    const item = await newItem();
    const post = () => api().post(`/items/${item.id}/comments`).set(auth(f.alice.token))
      .set('Idempotency-Key', 'comment-1').send({ body: 'Checked with the bank' });

    const [a, b] = await Promise.all([post(), post()]);

    expect([a.status, b.status]).toEqual([201, 201]);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM comments WHERE item_id = $1', [item.id]);
    expect(rows[0].n).toBe(1);
  });

  it('reusing a key for a different action is refused with 422', async () => {
    const item = await newItem();
    await api().post(`/items/${item.id}/claim`).set(auth(f.alice.token)).set('Idempotency-Key', 'k').expect(200);

    const res = await api().post(`/items/${item.id}/comments`).set(auth(f.alice.token))
      .set('Idempotency-Key', 'k').send({ body: 'hi' });

    expect(res.status).toBe(422);
  });

  it('keys are per user: the same key from someone else is a separate request', async () => {
    const item = await newItem();
    await api().post(`/items/${item.id}/claim`).set(auth(f.alice.token)).set('Idempotency-Key', 'shared').expect(200);

    await api().post(`/items/${item.id}/claim`).set(auth(f.bob.token)).set('Idempotency-Key', 'shared').expect(409);
  });
});

