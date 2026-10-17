import { beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db';
import { handlers, processNextJob, type Handler } from '../src/worker';
import { api, auth, createItem, seedFixture, type Fixture } from './helpers';

// Critical behaviour 6: reliable async work with a transactional outbox.
describe('outbox worker', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await seedFixture();
  });

  // Runs the worker until no due jobs are left.
  async function drain(registry: Record<string, Handler> = handlers) {
    while (await processNextJob(registry));
  }
  const jobs = async () => (await pool.query('SELECT * FROM outbox_jobs ORDER BY id')).rows;
  const notifications = async () => (await pool.query('SELECT * FROM notifications ORDER BY id')).rows;
  async function addJob(kind: string, maxAttempts = 5) {
    const item = await createItem(f.alice, f.payments);
    const { rows } = await pool.query(
      'INSERT INTO outbox_jobs (kind, payload, max_attempts) VALUES ($1, $2, $3) RETURNING id',
      [kind, { userId: f.alice.id, itemId: item.id, message: 'hello' }, maxAttempts],
    );
    return rows[0].id;
  }

  it('a claim writes its job in the same transaction; a rejected claim writes none', async () => {
    const item = await createItem(f.alice, f.payments);
    await api().post(`/items/${item.id}/claim`).set(auth(f.bob.token)).expect(200);
    await api().post(`/items/${item.id}/claim`).set(auth(f.lee.token)).expect(409);

    const all = await jobs();
    expect(all).toHaveLength(1); // only the successful claim
    expect(all[0]).toMatchObject({ kind: 'notify', status: 'pending' });
    expect(all[0].payload).toMatchObject({ userId: f.alice.id, itemId: item.id });
  });

  it('the worker delivers the notification and marks the job done', async () => {
    const item = await createItem(f.alice, f.payments);
    await api().post(`/items/${item.id}/claim`).set(auth(f.bob.token)).expect(200);

    await drain();

    expect((await jobs())[0]).toMatchObject({ status: 'done', attempts: 1 });
    const res = await api().get('/notifications').set(auth(f.alice.token)).expect(200);
    expect(res.body.notifications).toEqual([expect.objectContaining({ item_id: item.id, message: expect.stringContaining('claimed') })]);
  });

  it('a job processed twice produces one notification (idempotent handler)', async () => {
    const jobId = await addJob('notify');
    await drain();
    // Simulate redelivery, e.g. the worker crashed after doing the work but before marking it done.
    await pool.query("UPDATE outbox_jobs SET status = 'pending' WHERE id = $1", [jobId]);
    await drain();

    expect(await notifications()).toHaveLength(1);
  });

  it('retries a failing job with backoff, then marks it failed after max attempts', async () => {
    const jobId = await addJob('flaky', 3);
    const registry = { flaky: async () => { throw new Error('mail server down'); } };

    await drain(registry);
    let [job] = await jobs();
    expect(job).toMatchObject({ status: 'pending', attempts: 1, last_error: 'mail server down' });
    expect(job.run_after.getTime()).toBeGreaterThan(Date.now()); // backoff: not due yet

    // Fast-forward time twice more.
    for (let i = 0; i < 2; i++) {
      await pool.query('UPDATE outbox_jobs SET run_after = now() WHERE id = $1', [jobId]);
      await drain(registry);
    }
    [job] = await jobs();
    expect(job).toMatchObject({ status: 'failed', attempts: 3 });

    // A failed job is never picked up again.
    await pool.query('UPDATE outbox_jobs SET run_after = now() WHERE id = $1', [jobId]);
    expect(await processNextJob(registry)).toBe(false);
  });

  it('a failing handler’s partial writes are rolled back', async () => {
    await addJob('half_done', 1);
    const registry: Record<string, Handler> = {
      half_done: async (client, job) => {
        await handlers.notify(client, job); // writes a notification...
        throw new Error('then crashes');    // ...then fails
      },
    };

    await drain(registry);

    expect(await notifications()).toHaveLength(0);
    expect((await jobs())[0]).toMatchObject({ status: 'failed' });
  });

  it('two workers in parallel never run the same job (SKIP LOCKED)', async () => {
    for (let i = 0; i < 20; i++) await addJob('count');
    const runs = new Map<number, number>();
    const registry = {
      count: async (_c: unknown, job: { id: number }) => {
        runs.set(job.id, (runs.get(job.id) ?? 0) + 1);
        await new Promise((r) => setTimeout(r, 5)); // hold the lock briefly so the workers overlap
      },
    };

    await Promise.all([drain(registry), drain(registry)]);

    expect(runs.size).toBe(20);
    expect([...runs.values()].every((n) => n === 1)).toBe(true);
    expect((await jobs()).every((j) => j.status === 'done')).toBe(true);
  });
});
