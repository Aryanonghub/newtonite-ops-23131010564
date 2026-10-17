import type { PoolClient } from 'pg';

// Transactional outbox: the job row commits or rolls back together with the change
// that caused it. A separate worker (step 5) picks it up and does the slow side effect.
export async function enqueueJob(client: PoolClient, kind: string, payload: Record<string, unknown>) {
  await client.query('INSERT INTO outbox_jobs (kind, payload) VALUES ($1, $2)', [kind, JSON.stringify(payload)]);
}
