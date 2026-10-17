import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { api, auth, createItem, dbEvents, seedFixture, type Fixture } from './helpers';

describe('activity history', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await seedFixture();
  });

  it('is append-only: the database rejects UPDATE and DELETE', async () => {
    const item = await createItem(f.alice, f.payments);

    await expect(pool.query("UPDATE activity_events SET to_value = 'x' WHERE item_id = $1", [item.id]))
      .rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM activity_events WHERE item_id = $1', [item.id]))
      .rejects.toThrow(/append-only/);
  });

  it('comments appear in the history with their text', async () => {
    const item = await createItem(f.alice, f.payments);
    await api().post(`/items/${item.id}/comments`).set(auth(f.bob.token)).send({ body: 'Looking now' }).expect(201);

    const res = await api().get(`/items/${item.id}/activity`).set(auth(f.alice.token)).expect(200);

    expect(res.body.events.map((e: { kind: string }) => e.kind)).toEqual(['created', 'commented']);
    expect(res.body.events[1]).toMatchObject({ actor_name: 'bob', comment: 'Looking now' });
  });

  it('a rejected write leaves no history behind (same transaction)', async () => {
    const item = await createItem(f.alice, f.payments);
    const before = await dbEvents(item.id);

    await api().post(`/items/${item.id}/comments`).set(auth(f.vic.token)).send({ body: 'x' }).expect(403);
    await api().post(`/items/${item.id}/transition`).set(auth(f.alice.token)).send({ to: 'closed', version: 1 }).expect(422);

    expect(await dbEvents(item.id)).toEqual(before);
    const comments = await pool.query('SELECT count(*)::int AS n FROM comments');
    expect(comments.rows[0].n).toBe(0);
  });
});
