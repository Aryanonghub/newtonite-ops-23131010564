import { beforeEach, describe, expect, it } from 'vitest';
import { api, auth, createItem, dbEvents, dbItem, seedFixture, type Fixture } from './helpers';

// Critical behaviour 1: concurrent claim.
// No outer transaction here: each request uses its own connection and commits for real,
// so the requests genuinely race inside Postgres.
describe('POST /items/:id/claim under concurrency', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await seedFixture();
  });

  it('two parallel claims: exactly one succeeds, the other gets 409', async () => {
    const item = await createItem(f.lee, f.payments);

    // Promise.all sends both requests before waiting for either.
    const [a, b] = await Promise.all([
      api().post(`/items/${item.id}/claim`).set(auth(f.alice.token)),
      api().post(`/items/${item.id}/claim`).set(auth(f.bob.token)),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? f.alice : f.bob;
    const loser = a.status === 200 ? b : a;
    expect(loser.body.item.assignee_id).toBe(winner.id); // 409 carries the latest item

    // The database and the history agree: one assignee, one claim recorded.
    expect(await dbItem(item.id)).toMatchObject({ assignee_id: winner.id, status: 'in_progress', version: 2 });
    const claims = (await dbEvents(item.id)).filter((e) => e.kind === 'assignee_changed');
    expect(claims).toEqual([expect.objectContaining({ actor_id: winner.id, to_value: String(winner.id) })]);
  });

  it('ten parallel claims: exactly one succeeds', async () => {
    const item = await createItem(f.lee, f.payments);
    const claimers = [f.alice, f.bob, f.lee, f.ada];

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        api().post(`/items/${item.id}/claim`).set(auth(claimers[i % claimers.length].token))),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
    expect((await dbItem(item.id)).version).toBe(2); // updated exactly once
  });

  it('claiming an item that is already claimed returns 409 and changes nothing', async () => {
    const item = await createItem(f.lee, f.payments);
    await api().post(`/items/${item.id}/claim`).set(auth(f.alice.token)).expect(200);

    const res = await api().post(`/items/${item.id}/claim`).set(auth(f.bob.token));

    expect(res.status).toBe(409);
    expect(await dbItem(item.id)).toMatchObject({ assignee_id: f.alice.id, version: 2 });
  });
});
