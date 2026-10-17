import type { PoolClient } from 'pg';

export type EventKind =
  | 'created' | 'status_changed' | 'assignee_changed' | 'priority_changed' | 'edited' | 'commented';

// Appends one history row. Takes a transaction client (not the pool) on purpose:
// history must be written in the same transaction as the change it describes.
export async function recordEvent(
  client: PoolClient,
  e: { itemId: number; actorId: number; kind: EventKind; field?: string;
       from?: string | null; to?: string | null; commentId?: number },
) {
  await client.query(
    `INSERT INTO activity_events (item_id, actor_id, kind, field, from_value, to_value, comment_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [e.itemId, e.actorId, e.kind, e.field ?? null, e.from ?? null, e.to ?? null, e.commentId ?? null],
  );
}
