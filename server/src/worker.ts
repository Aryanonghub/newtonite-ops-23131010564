import type { PoolClient } from 'pg';
import { pool } from './db';

export interface Job {
  id: number;
  kind: string;
  payload: Record<string, any>;
  attempts: number;
  max_attempts: number;
}
export type Handler = (client: PoolClient, job: Job) => Promise<void>;

export const handlers: Record<string, Handler> = {
  // Idempotent: job_id is UNIQUE, so running the same job twice still gives one notification.
  notify: async (client, job) => {
    await client.query(
      `INSERT INTO notifications (job_id, user_id, item_id, message) VALUES ($1, $2, $3, $4)
       ON CONFLICT (job_id) DO NOTHING`,
      [job.id, job.payload.userId, job.payload.itemId, job.payload.message],
    );
  },
};

// Exponential backoff: 2s, 4s, 8s, 16s ... capped at 5 minutes.
export const backoffSeconds = (attempts: number) => Math.min(2 ** attempts, 300);

// Takes one due job, runs it, and records the result. Returns false if there was nothing to do.
export async function processNextJob(registry: Record<string, Handler> = handlers): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // FOR UPDATE locks the job row until COMMIT. SKIP LOCKED makes other workers skip
    // rows that are already locked instead of waiting, so workers never get the same job.
    const { rows } = await client.query(
      `SELECT id, kind, payload, attempts, max_attempts FROM outbox_jobs
        WHERE status = 'pending' AND run_after <= now()
        ORDER BY run_after, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
    );
    const job: Job | undefined = rows[0];
    if (!job) {
      await client.query('COMMIT');
      return false;
    }

    // Savepoint: if the handler fails, undo only its work, but keep the job lock
    // so we can record the failure in this same transaction.
    await client.query('SAVEPOINT handler');
    try {
      const handler = registry[job.kind];
      if (!handler) throw new Error(`No handler for job kind "${job.kind}"`);
      await handler(client, job);
      await client.query(
        `UPDATE outbox_jobs SET status = 'done', attempts = attempts + 1, updated_at = now() WHERE id = $1`,
        [job.id],
      );
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT handler');
      const attempts = job.attempts + 1;
      const status = attempts >= job.max_attempts ? 'failed' : 'pending'; // give up after max attempts
      await client.query(
        `UPDATE outbox_jobs
            SET attempts = $2, status = $3, last_error = $4,
                run_after = now() + make_interval(secs => $5), updated_at = now()
          WHERE id = $1`,
        [job.id, attempts, status, err instanceof Error ? err.message : String(err), backoffSeconds(attempts)],
      );
      console.error(`job ${job.id} (${job.kind}) attempt ${attempts} failed -> ${status}`);
    }

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Long-running loop: work while there are jobs, otherwise poll once a second.
async function runWorker(isStopped: () => boolean) {
  while (!isStopped()) {
    try {
      const didWork = await processNextJob();
      if (!didWork) await sleep(1000);
    } catch (err) {
      // e.g. database not ready yet: log, wait, try again instead of crashing
      console.error('worker error:', err instanceof Error ? err.message : err);
      await sleep(5000);
    }
  }
}

if (require.main === module) {
  let stopped = false;
  const stop = () => {
    stopped = true; // finish the current job, then exit
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  console.log('outbox worker started');
  runWorker(() => stopped).then(() => pool.end());
}
