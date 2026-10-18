import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { api, auth, createItem, seedFixture, type Fixture } from './helpers';

describe('GET /items (filters + cursor pagination)', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await seedFixture();
  });

  // Follows nextCursor until the end and returns every id seen, in order.
  async function readAllPages(token: string, query: string) {
    const ids: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const url: string = `/items?${query}${cursor ? `&cursor=${cursor}` : ''}`;
      const res = await api().get(url).set(auth(token)).expect(200);
      ids.push(...res.body.items.map((i: { id: number }) => i.id));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor);
    return { ids, pages };
  }

  it('pages through every item exactly once, newest first', async () => {
    for (let i = 0; i < 7; i++) await createItem(f.alice, f.payments, { title: `Item ${i}` });

    const { ids, pages } = await readAllPages(f.alice.token, 'limit=3');

    expect(pages).toBe(3); // 3 + 3 + 1
    expect(ids).toEqual([7, 6, 5, 4, 3, 2, 1]);
  });

  it('does not skip or repeat items that share the same created_at (id breaks the tie)', async () => {
    await pool.query(
      `INSERT INTO work_items (title, type, priority, team_id, created_by, created_at)
       SELECT 'Same time ' || g, 'task', 'low', $1, $2, '2026-01-01T00:00:00Z' FROM generate_series(1, 5) g`,
      [f.payments, f.alice.id],
    );

    const { ids } = await readAllPages(f.alice.token, 'limit=2');

    expect(ids).toEqual([5, 4, 3, 2, 1]);
  });

  it('filters by status, priority, type and assignee', async () => {
    const a = await createItem(f.alice, f.payments, { priority: 'urgent', type: 'payment' });
    await createItem(f.alice, f.payments, { priority: 'low', type: 'task' });
    await api().post(`/items/${a.id}/claim`).set(auth(f.bob.token)).expect(200);

    const get = async (q: string, token = f.alice.token) =>
      (await api().get(`/items?${q}`).set(auth(token)).expect(200)).body.items.map((i: { id: number }) => i.id);

    expect(await get('status=in_progress')).toEqual([a.id]);
    expect(await get('priority=urgent')).toEqual([a.id]);
    expect(await get('type=payment')).toEqual([a.id]);
    expect(await get(`assignee=${f.bob.id}`)).toEqual([a.id]);
    expect(await get('assignee=me', f.bob.token)).toEqual([a.id]);
    expect(await get('assignee=none')).not.toContain(a.id);
  });

  it('searches titles, treating % and _ as normal characters', async () => {
    const refund = await createItem(f.alice, f.payments, { title: 'Refund failed for order 42' });
    const percent = await createItem(f.alice, f.payments, { title: 'Fee is 100% wrong' });
    await createItem(f.alice, f.payments, { title: 'Something else' });

    const search = async (q: string) =>
      (await api().get(`/items?q=${encodeURIComponent(q)}`).set(auth(f.alice.token)).expect(200))
        .body.items.map((i: { id: number }) => i.id);

    expect(await search('refund')).toEqual([refund.id]); // case-insensitive
    expect(await search('%')).toEqual([percent.id]);     // not "match everything"
  });

  describe('full-text search', () => {
    const search = async (q: string) =>
      (await api().get(`/items?q=${encodeURIComponent(q)}`).set(auth(f.alice.token)).expect(200))
        .body.items.map((i: { id: number }) => i.id);

    it('finds words in the description, not just the title', async () => {
      const item = await createItem(f.alice, f.payments, { title: 'Customer issue', description: 'Chargeback from Visa' });
      await createItem(f.alice, f.payments, { title: 'Something else' });

      expect(await search('chargeback')).toEqual([item.id]);
    });

    it('ignores word order and matches word forms', async () => {
      const item = await createItem(f.alice, f.payments, { title: 'Card payment declined' });
      await createItem(f.alice, f.payments, { title: 'Card replaced' });

      expect(await search('declined card')).toEqual([item.id]); // different order
      expect(await search('payments declining')).toEqual([item.id]); // different word forms
    });

    it('supports "exact phrase" and -exclude', async () => {
      const phrase = await createItem(f.alice, f.payments, { title: 'Card declined at checkout' });
      const other = await createItem(f.alice, f.payments, { title: 'Declined refund for card' });

      expect(await search('"card declined"')).toEqual([phrase.id]);
      expect(await search('declined -refund')).toEqual([phrase.id]);
      expect(await search('declined card')).toEqual([other.id, phrase.id]); // both, newest first
    });

    it('still matches part of a word in the title', async () => {
      const item = await createItem(f.alice, f.payments, { title: 'Payout delayed' });

      expect(await search('payo')).toEqual([item.id]);
    });

    it('only searches the user’s own teams', async () => {
      await createItem(f.sam, f.support, { title: 'Chargeback in Support' });

      expect(await search('chargeback')).toEqual([]);
    });
  });

  it('rejects bad query values with 400', async () => {
    await api().get('/items?status=nope').set(auth(f.alice.token)).expect(400);
    await api().get('/items?limit=1000').set(auth(f.alice.token)).expect(400);
    await api().get('/items?cursor=%%%').set(auth(f.alice.token)).expect(400);
  });

  it('GET /items/stats counts only the user\'s own teams', async () => {
    const a = await createItem(f.alice, f.payments);
    await createItem(f.alice, f.payments);
    await createItem(f.sam, f.support); // another team: must not be counted for Alice
    await api().post(`/items/${a.id}/claim`).set(auth(f.alice.token)).expect(200);

    const res = await api().get('/items/stats').set(auth(f.alice.token)).expect(200);

    expect(res.body).toMatchObject({
      total: 2,
      byStatus: { open: 1, in_progress: 1, awaiting_approval: 0, resolved: 0, closed: 0 },
      assignedToMe: 1,
      unassigned: 1,
      newToday: 2,
    });
  });
});
