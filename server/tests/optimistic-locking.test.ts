import { beforeEach, describe, expect, it } from 'vitest';
import { api, auth, createItem, dbEvents, dbItem, seedFixture, type Fixture } from './helpers';

// Critical behaviour 2: stale edits are rejected (optimistic locking with `version`).
describe('optimistic locking', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await seedFixture();
  });

  it('PATCH with an old version gets 409 with the latest item, and data is unchanged', async () => {
    const item = await createItem(f.alice, f.payments, { priority: 'high' }); // version 1

    // Alice saves first -> version 2.
    await api().patch(`/items/${item.id}`).set(auth(f.alice.token))
      .send({ version: 1, title: 'Edited by Alice' }).expect(200);

    // Bob still has version 1 open in his browser.
    const stale = await api().patch(`/items/${item.id}`).set(auth(f.bob.token))
      .send({ version: 1, title: 'Edited by Bob', priority: 'low' });

    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('alice edited the title since you loaded this item.'); // who, and what
    expect(stale.body.item).toMatchObject({ title: 'Edited by Alice', version: 2 });
    expect(await dbItem(item.id)).toMatchObject({ title: 'Edited by Alice', priority: 'high', version: 2 });
    // Bob's rejected edit left no trace in the history.
    const events = await dbEvents(item.id);
    expect(events.filter((e) => e.kind === 'edited')).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'priority_changed')).toHaveLength(0);
  });

  it('two parallel edits with the same version: one wins, one gets 409', async () => {
    const item = await createItem(f.alice, f.payments);

    const [a, b] = await Promise.all([
      api().patch(`/items/${item.id}`).set(auth(f.alice.token)).send({ version: 1, title: 'A' }),
      api().patch(`/items/${item.id}`).set(auth(f.bob.token)).send({ version: 1, title: 'B' }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winnerTitle = a.status === 200 ? 'A' : 'B';
    expect(await dbItem(item.id)).toMatchObject({ title: winnerTitle, version: 2 });
  });

  it('a transition with an old version gets 409', async () => {
    const item = await createItem(f.alice, f.payments);
    await api().post(`/items/${item.id}/claim`).set(auth(f.alice.token)).expect(200); // version 2

    const res = await api().post(`/items/${item.id}/transition`).set(auth(f.alice.token))
      .send({ to: 'awaiting_approval', version: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('alice moved it to in progress since you loaded this item.');
    expect((await dbItem(item.id)).status).toBe('in_progress');
  });

  it('records priority changes as their own history event', async () => {
    const item = await createItem(f.alice, f.payments, { priority: 'low' });

    await api().patch(`/items/${item.id}`).set(auth(f.alice.token))
      .send({ version: 1, priority: 'urgent' }).expect(200);

    expect(await dbEvents(item.id)).toContainEqual(
      expect.objectContaining({ kind: 'priority_changed', from_value: 'low', to_value: 'urgent' }));
  });

  it('PATCH cannot change status or assignee (only /claim and /transition can)', async () => {
    const item = await createItem(f.alice, f.payments);

    const res = await api().patch(`/items/${item.id}`).set(auth(f.alice.token))
      .send({ version: 1, status: 'closed' });

    expect(res.status).toBe(400);
    expect((await dbItem(item.id)).status).toBe('open');
  });
});
