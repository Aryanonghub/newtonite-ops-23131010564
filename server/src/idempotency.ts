import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { HttpError } from './errors';

export interface StoredResponse {
  status: number;
  body: unknown;
}

// Fingerprint of the request, to detect "same key, different request".
// We hash the validated input, so key order and extra whitespace in the raw JSON don't matter.
export function hashRequest(input: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

// Step 1 of every idempotent write. Returns the stored response if this key was used before,
// otherwise reserves the key (inside the caller's transaction) and returns null.
export async function claimIdempotencyKey(
  client: PoolClient, userId: number, key: string, requestHash: string,
): Promise<StoredResponse | null> {
  // If another request with the same key is still running, this INSERT waits on the
  // primary key until that transaction ends. So two retries can never both create an item.
  const inserted = await client.query(
    `INSERT INTO idempotency_keys (user_id, key, request_hash) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, key) DO NOTHING RETURNING key`,
    [userId, key, requestHash],
  );
  if (inserted.rowCount === 1) return null; // first time we see this key

  const { rows } = await client.query(
    'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE user_id = $1 AND key = $2',
    [userId, key],
  );
  if (rows[0].request_hash !== requestHash) {
    throw new HttpError(422, 'Idempotency-Key was already used with a different request');
  }
  return { status: rows[0].response_status, body: rows[0].response_body };
}

// Last step before COMMIT: remember what we answered.
export async function saveIdempotentResponse(
  client: PoolClient, userId: number, key: string, response: StoredResponse,
) {
  await client.query(
    'UPDATE idempotency_keys SET response_status = $3, response_body = $4 WHERE user_id = $1 AND key = $2',
    [userId, key, response.status, JSON.stringify(response.body)],
  );
}

// Reads the Idempotency-Key header. Required on create; optional on the other writes, so older
// clients keep working (without a key, a retry is treated as a new request).
export function readIdempotencyKey(header: string | undefined, required: boolean): string | undefined {
  if (header === undefined) {
    if (required) throw new HttpError(400, 'Idempotency-Key header is required (max 200 chars)');
    return undefined;
  }
  if (header.length === 0 || header.length > 200) throw new HttpError(400, 'Idempotency-Key must be 1 to 200 characters');
  return header;
}

// Wraps one write inside the caller's transaction:
// a key seen before -> replay the stored response; new key -> run the write and store its response.
// If the write throws (403, 409, 422...), the transaction rolls back, the key is released, and
// nothing is stored, so only successful responses are ever replayed.
export async function withIdempotency(
  client: PoolClient, userId: number, key: string | undefined, requestHash: string,
  write: () => Promise<StoredResponse>,
): Promise<StoredResponse & { replayed: boolean }> {
  if (key === undefined) return { ...(await write()), replayed: false };
  const stored = await claimIdempotencyKey(client, userId, key, requestHash);
  if (stored) return { ...stored, replayed: true };
  const response = await write();
  await saveIdempotentResponse(client, userId, key, response);
  return { ...response, replayed: false };
}
