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

  it('a second approver gets 409 "changed", not a workflow error', async () => {
    const item = await awaitingApproval();
    await transition(f.lee, item.id, 'resolved', 3).expect(200);

    // Ada's page still shows version 3 / Awaiting Approval.
    const res = await transition(f.ada, item.id, 'resolved', 3);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('lee approved it since you loaded this item.');
    expect(res.body.item).toMatchObject({ status: 'resolved', version: 4 });
  });

  it('two Leads approving at the same moment: one 200, one 409', async () => {
    const item = await awaitingApproval();

    const results = await Promise.all([
      transition(f.lee, item.id, 'resolved', 3),
      transition(f.ada, item.id, 'resolved', 3),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const approvals = (await dbEvents(item.id)).filter((e) => e.to_value === 'resolved');
    expect(approvals).toHaveLength(1); // history records exactly one approval
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

  it('four-eyes: a Lead cannot approve an item they submitted; another Lead can', async () => {
    const item = await createItem(f.lee, f.payments);
    await api().post(`/items/${item.id}/claim`).set(auth(f.lee.token)).expect(200);
    await transition(f.lee, item.id, 'awaiting_approval', 2).expect(200);
    expect((await dbItem(item.id)).submitted_by).toBe(f.lee.id);

    const res = await transition(f.lee, item.id, 'resolved', 3);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/someone else must approve/);
    expect(await dbItem(item.id)).toMatchObject({ status: 'awaiting_approval', version: 3 });

    await transition(f.ada, item.id, 'resolved', 3).expect(200);
    expect(await dbItem(item.id)).toMatchObject({ status: 'resolved', submitted_by: null });
  });

  it('four-eyes applies to Admins too', async () => {
    const item = await createItem(f.ada, f.payments);
    await api().post(`/items/${item.id}/claim`).set(auth(f.ada.token)).expect(200);
    await transition(f.ada, item.id, 'awaiting_approval', 2).expect(200);

    await transition(f.ada, item.id, 'resolved', 3).expect(403);
  });

  it('four-eyes: my own submissions are not in my "awaiting my approval" list', async () => {
    const mine = await createItem(f.lee, f.payments);
    await api().post(`/items/${mine.id}/claim`).set(auth(f.lee.token)).expect(200);
    await transition(f.lee, mine.id, 'awaiting_approval', 2).expect(200);
    const theirs = await awaitingApproval(); // submitted by Alice

    const dash = await api().get('/dashboard').set(auth(f.lee.token)).expect(200);

    expect(dash.body.awaitingMyApproval.map((i: { id: number }) => i.id)).toEqual([theirs.id]);
  });

  it('sending back clears the submitter, so whoever resubmits is the new submitter', async () => {
    const item = await awaitingApproval(); // Alice submitted
    await transition(f.lee, item.id, 'in_progress', 3).expect(200);
    expect((await dbItem(item.id)).submitted_by).toBeNull();

    await transition(f.lee, item.id, 'awaiting_approval', 4).expect(200);

    await transition(f.lee, item.id, 'resolved', 5).expect(403); // Lee submitted this time
    await transition(f.ada, item.id, 'resolved', 5).expect(200);
  });

  it('ownership: a Member cannot move an item assigned to someone else', async () => {
    const item = await createItem(f.bob, f.payments);
    await api().post(`/items/${item.id}/claim`).set(auth(f.alice.token)).expect(200); // Alice owns it

    const res = await transition(f.bob, item.id, 'awaiting_approval', 2);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Only the assignee or a Lead can move this item');
    expect(await dbItem(item.id)).toMatchObject({ status: 'in_progress', version: 2 });
    expect((await dbEvents(item.id)).filter((e) => e.kind === 'status_changed')).toHaveLength(1); // only the claim
  });

  it('ownership: the assignee and a Lead can move it; other Members can still comment', async () => {
    const item = await createItem(f.bob, f.payments);
    await api().post(`/items/${item.id}/claim`).set(auth(f.alice.token)).expect(200);

    await transition(f.alice, item.id, 'awaiting_approval', 2).expect(200); // the assignee
    await transition(f.lee, item.id, 'in_progress', 3).expect(200);         // a Lead (send back)
    await api().post(`/items/${item.id}/comments`).set(auth(f.bob.token)).send({ body: 'FYI' }).expect(201);
  });

  it('ownership: a Member on an Open item still gets the workflow hint, not a 403', async () => {
    const item = await createItem(f.bob, f.payments);

    const res = await transition(f.alice, item.id, 'awaiting_approval', 1);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/claim the item/);
  });

  it('a Viewer cannot move items', async () => {
    const item = await createItem(f.alice, f.payments);
    await api().post(`/items/${item.id}/claim`).set(auth(f.alice.token)).expect(200);

    const res = await transition(f.vic, item.id, 'awaiting_approval', 2);

    expect(res.status).toBe(403);
  });
});
