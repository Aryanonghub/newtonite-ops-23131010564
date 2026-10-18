import { Router, type Response } from 'express';
import type { PoolClient } from 'pg';
import { recordEvent } from '../activity';
import { currentUser, requireAuth } from '../auth';
import { config } from '../config';
import { pool, withTransaction } from '../db';
import { HttpError } from '../errors';
import { hashRequest, readIdempotencyKey, withIdempotency, type StoredResponse } from '../idempotency';
import {
  ITEM_SELECT, commentSchema, createItemSchema, decodeCursor, encodeCursor, fetchItem, listQuerySchema,
  parse, parseId, patchItemSchema, transitionSchema, type Item,
} from '../items';
import { enqueueJob } from '../outbox';
import { authorize, readableTeamIds } from '../permissions';
import { STATUSES, checkTransition } from '../workflow';

export const itemsRouter = Router();
itemsRouter.use(requireAuth);

// Loads the item inside the transaction, or 404s.
async function loadItem(client: PoolClient, id: number): Promise<Item> {
  const item = await fetchItem(client, id);
  if (!item) throw new HttpError(404, 'Not found');
  return item;
}

// Used when a conditional UPDATE matched 0 rows: tell the client who got there first, and send
// the latest item so the UI can show what changed without another request.
async function conflict(client: PoolClient, id: number, reason: 'claimed' | 'stale'): Promise<never> {
  const item = await fetchItem(client, id);
  const message = reason === 'claimed' && item?.assignee_name
    ? `${item.assignee_name} has already claimed this item.`
    : await describeLastChange(client, id);
  throw new HttpError(409, message, { item });
}

// "Priya approved it since you loaded this item." Built from the newest history event: the request
// that won had already committed it, which is why our UPDATE matched 0 rows. Comments are skipped
// because they don't change the item's version.
async function describeLastChange(client: PoolClient, id: number): Promise<string> {
  const { rows } = await client.query(
    `SELECT e.kind, e.field, e.from_value, e.to_value, u.name
       FROM activity_events e JOIN users u ON u.id = e.actor_id
      WHERE e.item_id = $1 AND e.kind <> 'commented'
      ORDER BY e.id DESC LIMIT 1`,
    [id],
  );
  const e = rows[0];
  if (!e) return 'This item was changed by someone else. Reload and try again.';
  const label = (value: string) => value.replace(/_/g, ' ');
  let what = 'changed it';
  if (e.kind === 'status_changed') {
    what = e.from_value === 'awaiting_approval' && e.to_value === 'resolved' ? 'approved it' : `moved it to ${label(e.to_value)}`;
  } else if (e.kind === 'priority_changed') {
    what = `changed the priority to ${e.to_value}`;
  } else if (e.kind === 'edited') {
    what = `edited the ${label(e.field)}`;
  }
  return `${e.name} ${what} since you loaded this item.`;
}

// Sends a write's response, marking replays of an earlier request with the same Idempotency-Key.
function send(res: Response, result: StoredResponse & { replayed: boolean }) {
  if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
  res.status(result.status).json(result.body);
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
    // Three ways to match, any is enough:
    // 1. Full-text over title + description: any word order, word forms ("refunds" finds "refund"),
    //    and web-style syntax ("exact phrase", -exclude). Uses the GIN index on search_vector.
    // 2. Partial title match, so typing part of a word ("paym") still works. Uses the trigram index.
    // params.push() returns the new length, which is the $n number of the value just added.
    const conditions = [
      `w.search_vector @@ websearch_to_tsquery('english', $${params.push(f.q)})`,
      `w.title ILIKE $${params.push(`%${f.q.replace(/[\\%_]/g, '\\$&')}%`)}`, // LIKE wildcards escaped
    ];
    // 3. An item id: "20013" or "#20013" also finds that item (still only within the user's teams).
    const id = /^#?(\d{1,9})$/.exec(f.q);
    if (id) conditions.push(`w.id = $${params.push(Number(id[1]))}`);
    where.push(`(${conditions.join(' OR ')})`);
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

// Counts for the stats row and the tab badges on the items page. Only the user's own teams, like every list.
// Registered before '/:id' so "stats" is not read as an item id.
itemsRouter.get('/stats', async (req, res) => {
  const user = currentUser(req);
  const teams = readableTeamIds(user);
  const [byStatus, created] = await Promise.all([
    pool.query(
      `SELECT status, count(*)::int AS n,
              count(*) FILTER (WHERE assignee_id = $2)::int AS mine,
              count(*) FILTER (WHERE assignee_id IS NULL)::int AS unassigned
         FROM work_items WHERE team_id = ANY($1) GROUP BY status`,
      [teams, user.id],
    ),
    // Only the last two days are read, so this uses the (team_id, created_at) index.
    pool.query(
      `SELECT count(*) FILTER (WHERE created_at >= date_trunc('day', now()))::int AS today,
              count(*) FILTER (WHERE created_at < date_trunc('day', now()))::int AS yesterday
         FROM work_items
        WHERE team_id = ANY($1) AND created_at >= date_trunc('day', now()) - interval '1 day'`,
      [teams],
    ),
  ]);

  const counts: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let assignedToMe = 0;
  let unassigned = 0;
  for (const row of byStatus.rows) {
    counts[row.status] = row.n;
    assignedToMe += row.mine; // same set as the list's assignee=me filter, so tab badges match the tab
    unassigned += row.unassigned;
  }
  res.json({
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    byStatus: counts,
    assignedToMe,
    unassigned,
    newToday: created.rows[0].today,
    newYesterday: created.rows[0].yesterday,
  });
});

itemsRouter.get('/:id', async (req, res) => {
  const user = currentUser(req);
  const item = await fetchItem(pool, parseId(req.params.id));
  if (!item) throw new HttpError(404, 'Not found');
  authorize(user, 'read', item);
  res.json(item);
});

// Live updates for one item, as a text/event-stream. It sends "change" whenever the item's version or
// its newest history event moves (comments included). The event carries no item data: the client
// refetches through the normal endpoints, which check permissions as usual. The stream ends after
// liveStreamSeconds (Vercel limits how long a function runs) and the client reconnects.
// Cost: one small indexed query per open stream every livePollMs. A LISTEN/NOTIFY design would avoid
// polling, but it needs a long-lived connection per stream, which Neon's pooler does not support.
itemsRouter.get('/:id/live', async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const item = await fetchItem(pool, id);
  if (!item) throw new HttpError(404, 'Not found');
  authorize(user, 'read', item);

  const snapshot = async () => {
    const { rows } = await pool.query(
      `SELECT w.version, (SELECT max(e.id) FROM activity_events e WHERE e.item_id = w.id) AS last_event
         FROM work_items w WHERE w.id = $1`,
      [id],
    );
    return JSON.stringify(rows[0]);
  };

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no', // tells nginx not to hold the events back
  });
  let closed = false;
  req.on('close', () => { closed = true; });

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const endAt = Date.now() + config.liveStreamSeconds * 1000;
  try {
    let last = await snapshot();
    res.write(': connected\n\n');
    while (!closed && Date.now() < endAt) {
      await sleep(config.livePollMs);
      if (closed) break;
      const now = await snapshot();
      if (now !== last) {
        last = now;
        res.write(`event: change\ndata: ${now}\n\n`);
      }
    }
  } catch {
    // e.g. the database went away mid-stream: just end it; the client reconnects.
  }
  res.end();
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
  const key = readIdempotencyKey(req.header('Idempotency-Key'), true);
  const input = parse(createItemSchema, req.body);

  const result = await withTransaction((client) => withIdempotency(client, user.id, key, hashRequest(input), async () => {
    authorize(user, 'create', { team_id: input.team_id });

    const { rows } = await client.query(
      `INSERT INTO work_items (title, description, type, priority, team_id, created_by, due_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [input.title, input.description, input.type, input.priority, input.team_id, user.id, input.due_date],
    );
    const id = rows[0].id;
    await recordEvent(client, { itemId: id, actorId: user.id, kind: 'created', to: 'open' });

    return { status: 201, body: await fetchItem(client, id) };
  }));
  send(res, result);
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
    if (rowCount === 0) await conflict(client, id, 'stale');

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
  const key = readIdempotencyKey(req.header('Idempotency-Key'), false);

  // With an Idempotency-Key, a retried claim whose first answer was lost gets that 200 again, not a 409.
  const result = await withTransaction((client) => withIdempotency(client, user.id, key, hashRequest({ claim: id }), async () => {
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
    if (rowCount === 0) await conflict(client, id, 'claimed');

    await recordEvent(client, { itemId: id, actorId: user.id, kind: 'assignee_changed', from: null, to: String(user.id) });
    await recordEvent(client, { itemId: id, actorId: user.id, kind: 'status_changed', from: before.status, to: 'in_progress' });
    if (before.created_by !== user.id) {
      await enqueueJob(client, 'notify', {
        userId: before.created_by, itemId: id, message: `${user.name} claimed "${before.title}"`,
      });
    }
    return { status: 200, body: await loadItem(client, id) };
  }));
  send(res, result);
});

// Move along the workflow, e.g. In Progress -> Awaiting Approval -> Resolved -> Closed.
itemsRouter.post('/:id/transition', async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const { to, version } = parse(transitionSchema, req.body);
  const key = readIdempotencyKey(req.header('Idempotency-Key'), false);

  // The key is checked first, so a retry of a move that already succeeded replays its 200
  // instead of failing the version check below with a 409.
  const result = await withTransaction((client) => withIdempotency(client, user.id, key, hashRequest({ transition: id, to, version }), async () => {
    const before = await loadItem(client, id);
    authorize(user, 'transition', before);
    // Stale page? Say so before checking workflow rules. Otherwise a second approver would get
    // "Cannot move from resolved to resolved" instead of "this item changed". The WHERE version
    // check below still handles two requests that both pass this line at the same instant.
    if (before.version !== version) await conflict(client, id, 'stale');
    checkTransition(user, before, to); // allowed-transitions map + Lead/Admin-only approval + four-eyes

    // Version check: also guarantees the status we validated above is still the current one.
    // submitted_by remembers who asked for approval (for the four-eyes rule); cleared on any other move.
    const { rowCount } = await client.query(
      `UPDATE work_items SET status = $3, submitted_by = $4, version = version + 1, updated_at = now()
        WHERE id = $1 AND version = $2`,
      [id, version, to, to === 'awaiting_approval' ? user.id : null],
    );
    if (rowCount === 0) await conflict(client, id, 'stale');

    await recordEvent(client, { itemId: id, actorId: user.id, kind: 'status_changed', from: before.status, to });
    if (before.assignee_id !== null && before.assignee_id !== user.id) {
      await enqueueJob(client, 'notify', {
        userId: before.assignee_id, itemId: id, message: `${user.name} moved "${before.title}" to ${to}`,
      });
    }
    return { status: 200, body: await loadItem(client, id) };
  }));
  send(res, result);
});

itemsRouter.post('/:id/comments', async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req.params.id);
  const { body } = parse(commentSchema, req.body);
  const key = readIdempotencyKey(req.header('Idempotency-Key'), false);

  // A double-clicked or retried comment is posted once.
  const result = await withTransaction((client) => withIdempotency(client, user.id, key, hashRequest({ comment: id, body }), async () => {
    const item = await loadItem(client, id);
    authorize(user, 'comment', item);
    const { rows } = await client.query(
      'INSERT INTO comments (item_id, author_id, body) VALUES ($1, $2, $3) RETURNING *',
      [id, user.id, body],
    );
    await recordEvent(client, { itemId: id, actorId: user.id, kind: 'commented', commentId: rows[0].id });
    return { status: 201, body: rows[0] };
  }));
  send(res, result);
});
