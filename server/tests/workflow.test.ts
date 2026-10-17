import { beforeEach, describe, expect, it } from 'vitest';
import { api, auth, createItem, dbEvents, dbItem, seedFixture, type Fixture, type TestUser } from './helpers';

// Critical behaviour 4: workflow rules (transition map + Lead/Admin-only approval).
describe('workflow', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await seedFixture();
  });

  const transition = (user: TestUser, id: number, to: string, version: number) =>
    api().post(`/items/${id}/transition`).set(auth(user.token)).send({ to, version });

  // Creates an item and moves it to Awaiting Approval. Returns it at version 3.
  async function awaitingApproval() {
    const item = await createItem(f.alice, f.payments);
    await api().post(`/items/${item.id}/claim`).set(auth(f.alice.token)).expect(200);
    await transition(f.alice, item.id, 'awaiting_approval', 2).expect(200);
    return item;
  }

  it('rejects Open -> Closed', async () => {
    const item = await createItem(f.alice, f.payments);

    const res = await transition(f.lee, item.id, 'closed', 1);

    expect(res.status).toBe(422);
    expect(await dbItem(item.id)).toMatchObject({ status: 'open', version: 1 });
  });

  it('rejects skipping approval: In Progress -> Resolved', async () => {
    const item = await createItem(f.alice, f.payments);
    await api().post(`/items/${item.id}/claim`).set(auth(f.alice.token)).expect(200);

    const res = await transition(f.lee, item.id, 'resolved', 2);

    expect(res.status).toBe(422);
  });

  it('rejects approval by a Member', async () => {
    const item = await awaitingApproval();

    const res = await transition(f.alice, item.id, 'resolved', 3);

    expect(res.status).toBe(403);
    expect(await dbItem(item.id)).toMatchObject({ status: 'awaiting_approval', version: 3 });
  });

  it('allows approval by a Lead', async () => {
    const item = await awaitingApproval();
    await transition(f.lee, item.id, 'resolved', 3).expect(200);
    expect((await dbItem(item.id)).status).toBe('resolved');
  });

  it('allows approval by an Admin', async () => {
    const item = await awaitingApproval();
    await transition(f.ada, item.id, 'resolved', 3).expect(200);
  });

  it('full happy path is recorded in order in the activity history', async () => {
    const item = await awaitingApproval();
    await transition(f.lee, item.id, 'resolved', 3).expect(200);
    await transition(f.alice, item.id, 'closed', 4).expect(200);

    const statusChanges = (await dbEvents(item.id))
      .filter((e) => e.kind === 'status_changed')
      .map((e) => `${e.from_value}->${e.to_value}`);
    expect(statusChanges).toEqual([
      'open->in_progress', 'in_progress->awaiting_approval', 'awaiting_approval->resolved', 'resolved->closed',
    ]);
    expect(await dbItem(item.id)).toMatchObject({ status: 'closed', version: 5 });
  });

  it('a Viewer cannot move items', async () => {
    const item = await createItem(f.alice, f.payments);
    await api().post(`/items/${item.id}/claim`).set(auth(f.alice.token)).expect(200);

    const res = await transition(f.vic, item.id, 'awaiting_approval', 2);

    expect(res.status).toBe(403);
  });
});
