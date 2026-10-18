import { Router } from 'express';
import type { PoolClient } from 'pg';
import { recordEvent } from '../activity';
import { currentUser, requireAuth } from '../auth';
import { pool, withTransaction } from '../db';
import { HttpError } from '../errors';
import { claimIdempotencyKey, hashRequest, saveIdempotentResponse } from '../idempotency';
import {
  ITEM_SELECT, commentSchema, createItemSchema, decodeCursor, encodeCursor, fetchItem, listQuerySchema,
  parse, parseId, patchItemSchema, transitionSchema, type Item,
} from '../items';
import { enqueueJob } from '../outbox';
import { authorize, readableTeamIds } from '../permissions';
import { checkTransition } from '../workflow';

export const itemsRouter = Router();
itemsRouter.use(requireAuth);

// Loads the item inside the transaction, or 404s.
async function loadItem(client: PoolClient, id: number): Promise<Item> {
  const item = await fetchItem(client, id);
  if (!item) throw new HttpError(404, 'Not found');
  return item;
}

// Used when a conditional UPDATE matched 0 rows: tell the client, and send the latest item
// so the UI can show what changed without another request.
async function conflict(client: PoolClient, id: number, message: string): Promise<never> {
  throw new HttpError(409, message, { item: await fetchItem(client, id) });
}

// ---------- Reads ----------

// List with filters and cursor pagination. Only items from the user's own teams.
itemsRouter.get('/', async (req, res) => {
  const user = currentUser(req);
  const f = parse(listQuerySchema, req.query);

  const params: unknown[] = [readableTeamIds(user)];
  const where = ['w.team_id = ANY($1)']; // the authorization filter, always first
  // Adds a condition with its value as a numbered parameter ($2, $3, ...). Values are never
  // put into the SQL string itself, so there is no SQL injection.
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (f.status) add('w.status = ?', f.status);
  if (f.priority) add('w.priority = ?', f.priority);
  if (f.type) add('w.type = ?', f.type);
  if (f.team) add('w.team_id = ?', f.team);
  if (f.assignee === 'none') where.push('w.assignee_id IS NULL');
  else if (f.assignee === 'me') add('w.assignee_id = ?', user.id);
  else if (f.assignee) add('w.assignee_id = ?', f.assignee);
  if (f.q) {
    // Two ways to match, either is enough:
    // 1. Full-text over title + description: any word order, word forms ("refunds" finds "refund"),
    //    and web-style syntax ("exact phrase", -exclude). Uses the GIN index on search_vector.
    // 2. Partial title match, so typing part of a word ("paym") still works. Uses the trigram index.
    params.push(f.q, `%${f.q.replace(/[\\%_]/g, '\\$&')}%`); // escape LIKE wildcards
    where.push(`(w.search_vector @@ websearch_to_tsquery('english', $${params.length - 1})
                 OR w.title ILIKE $${params.length})`);
  }
  // Keyset pagination: continue strictly after the last item of the previous page,
  // in the same (created_at DESC, id DESC) order. id breaks ties between equal timestamps.
  if (f.cursor) add('(w.created_at, w.id) < (SELECT created_at, id FROM work_items WHERE id = ?)', decodeCursor(f.cursor));

  params.push(f.limit + 1); // fetch one extra row to know if there is a next page
  const { rows } = await pool.query(
    `${ITEM_SELECT} WHERE ${where.join(' AND ')} ORDER BY w.created_at DESC, w.id DESC LIMIT $${params.length}`,
    params,
  );

  const hasMore = rows.length > f.limit;
  const items = rows.slice(0, f.limit);
  res.json({ items, nextCursor: hasMore ? encodeCursor(items[items.length - 1].id) : null });
});

itemsRouter.get('/:id', async (req, res) => {
  const user = currentUser(req);
  const item = await fetchItem(pool, parseId(req.params.id));
  if (!item) throw new HttpError(404, 'Not found');
  authorize(user, 'read', item);
  res.json(item);
});

itemsRouter.get('/:id/activity', async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const item = await fetchItem(pool, id);
  if (!item) throw new HttpError(404, 'Not found');
  authorize(user, 'read', item);

  const { rows } = await pool.query(
    `SELECT e.id, e.kind, e.field, e.from_value, e.to_value, e.created_at,
            e.actor_id, actor.name AS actor_name, c.body AS comment,
            CASE WHEN e.kind = 'assignee_changed'
                 THEN (SELECT name FROM users WHERE id = e.to_value::int) END AS to_name
       FROM activity_events e
       JOIN users actor ON actor.id = e.actor_id
       LEFT JOIN comments c ON c.id = e.comment_id
      WHERE e.item_id = $1
      ORDER BY e.id`,
    [id],
  );
  res.json({ events: rows });
});

// ---------- Writes ----------
// Every write: one transaction -> load item -> permission -> workflow rule ->
// conditional UPDATE -> activity event -> outbox job -> COMMIT.

itemsRouter.post('/', async (req, res) => {
  const user = currentUser(req);
  const key = req.header('Idempotency-Key');
  if (!key || key.length > 200) throw new HttpError(400, 'Idempotency-Key header is required (max 200 chars)');
  const input = parse(createItemSchema, req.body);

  const result = await withTransaction(async (client) => {
    const stored = await claimIdempotencyKey(client, user.id, key, hashRequest(input));
    if (stored) return { ...stored, replayed: true };

    authorize(user, 'create', { team_id: input.team_id });

    const { rows } = await client.query(
      `INSERT INTO work_items (title, description, type, priority, team_id, created_by, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [input.title, input.description, input.type, input.priority, input.team_id, user.id, input.due_date],
    );
    const id = rows[0].id;
    await recordEvent(client, { itemId: id, actorId: user.id, kind: 'created', to: 'open' });

    const response = { status: 201, body: await fetchItem(client, id) };
    await saveIdempotentResponse(client, user.id, key, response);
    return { ...response, replayed: false };
  });

  if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
  res.status(result.status).json(result.body);
});

// Edit title / description / priority / due date. Optimistic locking with `version`.
itemsRouter.patch('/:id', async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const { version, ...changes } = parse(patchItemSchema, req.body);
  const fields = Object.keys(changes) as (keyof typeof changes)[];
  if (fields.length === 0) throw new HttpError(400, 'Nothing to update');

  const item = await withTransaction(async (client) => {
    const before = await loadItem(client, id);
    authorize(user, 'edit', before);

    // Field names come from the zod schema's fixed list, never from raw user input.
    const sets = fields.map((f, i) => `${f} = $${i + 3}`).join(', ');
    // The version check lives in the WHERE clause, so it is atomic. If anyone saved since
    // the client loaded the item, version no longer matches and 0 rows are updated.
    const { rowCount } = await client.query(
      `UPDATE work_items SET ${sets}, version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $2`,
      [id, version, ...fields.map((f) => changes[f])],
    );
    if (rowCount === 0) await conflict(client, id, 'This item was changed by someone else. Reload and try again.');

    for (const f of fields) {
      const from = before[f] ?? null;
      const to = changes[f] ?? null;
      if (from === to) continue;
      if (f === 'priority') {
        await recordEvent(client, { itemId: id, actorId: user.id, kind: 'priority_changed', from, to });
      } else {
        await recordEvent(client, { itemId: id, actorId: user.id, kind: 'edited', field: f, from, to });
      }
    }
    return loadItem(client, id);
  });
  res.json(item);
});

// Claim: Open -> In Progress, and assign to me. Safe under concurrency.
itemsRouter.post('/:id/claim', async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);

  const item = await withTransaction(async (client) => {
    const before = await loadItem(client, id);
    authorize(user, 'claim', before);

    // The real guard is "AND assignee_id IS NULL" in the WHERE clause. If two claims race,
    // Postgres row-locks the item: the second UPDATE waits, then re-checks the WHERE on the
    // updated row, finds an assignee, and matches 0 rows. No app-level check can do this safely.
    const { rowCount } = await client.query(
      `UPDATE work_items SET assignee_id = $2, status = 'in_progress', version = version + 1, updated_at = now()
        WHERE id = $1 AND assignee_id IS NULL`,
      [id, user.id],
    );
    if (rowCount === 0) await conflict(client, id, 'This item was already claimed by someone else.');

    await recordEvent(client, { itemId: id, actorId: user.id, kind: 'assignee_changed', from: null, to: String(user.id) });
    await recordEvent(client, { itemId: id, actorId: user.id, kind: 'status_changed', from: before.status, to: 'in_progress' });
    if (before.created_by !== user.id) {
      await enqueueJob(client, 'notify', {
        userId: before.created_by, itemId: id, message: `${user.name} claimed "${before.title}"`,
      });
    }
    return loadItem(client, id);
  });
  res.json(item);
});

// Move along the workflow, e.g. In Progress -> Awaiting Approval -> Resolved -> Closed.
itemsRouter.post('/:id/transition', async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const { to, version } = parse(transitionSchema, req.body);

  const item = await withTransaction(async (client) => {
    const before = await loadItem(client, id);
    authorize(user, 'transition', before);
    // Stale page? Say so before checking workflow rules. Otherwise a second approver would get
    // "Cannot move from resolved to resolved" instead of "this item changed". The WHERE version
    // check below still handles two requests that both pass this line at the same instant.
    if (before.version !== version) await conflict(client, id, 'This item was changed by someone else. Reload and try again.');
    checkTransition(user, before, to); // allowed-transitions map + Lead/Admin-only approval + four-eyes

    // Version check: also guarantees the status we validated above is still the current one.
    // submitted_by remembers who asked for approval (for the four-eyes rule); cleared on any other move.
    const { rowCount } = await client.query(
      `UPDATE work_items SET status = $3, submitted_by = $4, version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $2`,
      [id, version, to, to === 'awaiting_approval' ? user.id : null],
    );
    if (rowCount === 0) await conflict(client, id, 'This item was changed by someone else. Reload and try again.');

    await recordEvent(client, { itemId: id, actorId: user.id, kind: 'status_changed', from: before.status, to });
    if (before.assignee_id !== null && before.assignee_id !== user.id) {
      await enqueueJob(client, 'notify', {
        userId: before.assignee_id, itemId: id, message: `${user.name} moved "${before.title}" to ${to}`,
      });
    }
    return loadItem(client, id);
  });
  res.json(item);
});

itemsRouter.post('/:id/comments', async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const { body } = parse(commentSchema, req.body);

  const comment = await withTransaction(async (client) => {
    const item = await loadItem(client, id);
    authorize(user, 'comment', item);
    const { rows } = await client.query(
      'INSERT INTO comments (item_id, author_id, body) VALUES ($1, $2, $3) RETURNING *',
      [id, user.id, body],
    );
    await recordEvent(client, { itemId: id, actorId: user.id, kind: 'commented', commentId: rows[0].id });
    return rows[0];
  });
  res.status(201).json(comment);
});
