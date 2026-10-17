import { beforeEach, describe, expect, it } from 'vitest';
import { can, type AuthUser } from '../src/permissions';
import { api, auth, createItem, dbItem, seedFixture, type Fixture } from './helpers';

// Critical behaviour 5: resource-level authorization, scoped to the item's team.
describe('authorization', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await seedFixture();
  });

  it('a user from another team gets 404 on every read and write, and nothing changes', async () => {
    const item = await createItem(f.alice, f.payments);
    const sam = auth(f.sam.token); // Support member, not in Payments

    await api().get(`/items/${item.id}`).set(sam).expect(404);
    await api().get(`/items/${item.id}/activity`).set(sam).expect(404);
    await api().patch(`/items/${item.id}`).set(sam).send({ version: 1, title: 'hacked' }).expect(404);
    await api().post(`/items/${item.id}/claim`).set(sam).expect(404);
    await api().post(`/items/${item.id}/transition`).set(sam).send({ to: 'closed', version: 1 }).expect(404);
    await api().post(`/items/${item.id}/comments`).set(sam).send({ body: 'hi' }).expect(404);

    expect(await dbItem(item.id)).toMatchObject({ title: 'Test item', status: 'open', version: 1 });
  });

  it('a user cannot create an item in a team they are not in', async () => {
    const res = await api().post('/items').set(auth(f.sam.token)).set('Idempotency-Key', 'k')
      .send({ title: 'x', type: 'task', priority: 'low', team_id: f.payments });
    expect(res.status).toBe(404);
  });

  it('list and dashboard only return items from the user’s own teams', async () => {
    await createItem(f.alice, f.payments, { priority: 'urgent' });
    await createItem(f.sam, f.support, { priority: 'urgent' });

    const samList = await api().get('/items').set(auth(f.sam.token)).expect(200);
    expect(samList.body.items.map((i: { team_id: number }) => i.team_id)).toEqual([f.support]);

    // Asking for another team explicitly still returns nothing.
    const forced = await api().get(`/items?team=${f.payments}`).set(auth(f.sam.token)).expect(200);
    expect(forced.body.items).toEqual([]);

    const dash = await api().get('/dashboard').set(auth(f.sam.token)).expect(200);
    expect(dash.body.unassignedUrgent.map((i: { team_id: number }) => i.team_id)).toEqual([f.support]);
  });

  it('a Viewer can read but not change anything', async () => {
    const item = await createItem(f.alice, f.payments);
    const vic = auth(f.vic.token);

    await api().get(`/items/${item.id}`).set(vic).expect(200);
    await api().post(`/items/${item.id}/claim`).set(vic).expect(403);
    await api().patch(`/items/${item.id}`).set(vic).send({ version: 1, title: 'x' }).expect(403);
    await api().post(`/items/${item.id}/comments`).set(vic).send({ body: 'x' }).expect(403);
  });

  it('requests without a valid token get 401', async () => {
    await api().get('/items').expect(401);
    await api().get('/items').set(auth('not-a-token')).expect(401);
  });

  it('can() only uses the role in the item’s own team', () => {
    const payments = { team_id: 1 };
    const support = { team_id: 2 };
    const lead: AuthUser = { id: 1, email: '', name: '', roles: { 1: 'lead' } };
    const viewer: AuthUser = { id: 2, email: '', name: '', roles: { 1: 'viewer', 2: 'member' } };

    expect(can(lead, 'approve', payments)).toBe(true);
    expect(can(lead, 'read', support)).toBe(false); // lead in Payments means nothing in Support
    expect(can(viewer, 'read', payments)).toBe(true);
    expect(can(viewer, 'edit', payments)).toBe(false);
    expect(can(viewer, 'edit', support)).toBe(true); // a different role in a different team
    expect(can(viewer, 'approve', support)).toBe(false);
  });
});
