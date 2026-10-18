# Engineering Decisions

One rule throughout: **put correctness where it can't be bypassed**: the database where possible, the server always, never only the browser.
Each decision: what I chose, why, what I rejected, and what it costs.

## Assumptions (★ = first to confirm with product)

- ★ An item gets an owner **only by being claimed**, which also moves it Open → In Progress. No reassign yet.
- Flow: Open → In Progress → Awaiting Approval → Resolved → Closed, plus Send back and Reopen. Closed is final.
- ★ Only a **Lead/Admin of the item's team** approves, and **never the person who submitted it** (four-eyes, Admins included).
- ★ Once an item is claimed, **only its assignee (or a Lead/Admin) can move it**, so history shows who did the work. Any Member can still claim Open items, edit and comment. Viewers are read-only. Roles are per team.
- `PATCH` edits only title, description, priority and due date. Status and owner change only via `/claim` and `/transition`.

## 1. History can never disagree with the item

- **Chose:** each write is one transaction: change + `activity_events` row + outbox job (`withTransaction` in `db.ts`). The database enforces the rest: a trigger makes history **append-only**, and CHECK constraints keep invariants (Open ⇔ no assignee; `submitted_by` set ⇔ Awaiting Approval).
- **Rejected:** history written by triggers (can't know *who* or *why*); event sourcing (too heavy for this scope).
- **Cost:** every write path must call `recordEvent()`.

## 2. Concurrency: conditional updates, not locks

- **Chose:** the guard is inside the `UPDATE`, so check-and-write is atomic:
  claim `WHERE id = $1 AND assignee_id IS NULL`; edit/transition `WHERE id = $1 AND version = $2`. 0 rows → **409 with the latest item and who won** ("Priya approved it since you loaded this item.").
- **Why:** contention per item is rare, and a loser should be told, not kept waiting. There is no JavaScript pre-check, so the SQL guard is the only guard: delete `AND assignee_id IS NULL` and the claim test fails with `[200, 200]`.
- **Rejected:** `SELECT … FOR UPDATE` (queues writers, can't span user think-time); check-then-update in code (both requests read "free").
- **Cost:** on conflict the user reloads and redoes the change. Nothing is merged.

## 3. Authorization: per-team roles, one function

- **Chose:** `memberships (user, team, role)`, with every check going through `can(user, action, item)` in `permissions.ts`. Roles are ranked viewer < member < lead < admin. Item-level rules live there too: four-eyes, and *only the assignee or a Lead/Admin moves an assigned item*. Lists always filter `team_id = ANY(myTeams)`.
- **Outside the team → 404** (it doesn't reveal the item exists). **Role too low → 403** with a reason the UI shows.
- Roles are reloaded from the DB on each request (the JWT holds only the user id), so removing someone takes effect immediately.
- **Rejected:** global roles (too coarse); a policy engine (overkill for 4 roles).
- **Cost:** one indexed query per request. Can't express rules like "Viewers may comment".

## 4. Idempotency: a Postgres table, inside the same transaction

- **Chose:** `idempotency_keys (user_id, key)` as the primary key. Step 1 of the write inserts the key: new → do the write and store the response; same key and same request → **replay the stored response byte-for-byte**; same key, different request → 422. Two identical requests at once: the second waits on the key, then replays. A failed write rolls back its key.
- **Where:** required on create, optional on claim, transition and comments (`withIdempotency`). It's checked *before* the version check, so a retry after a lost reply gets the original 200, not a misleading 409. The UI sends one key per click and retries only network errors.
- **Rejected:** disabling the button (doesn't cover retries); Redis (a second system, outside the transaction).
- **Cost:** keys never expire (needs a cleanup job). `PATCH` has no key; its version check already blocks double saves.

## 5. Async work: transactional outbox

- **Chose:** the outbox job is inserted in the same transaction as the change; the worker takes jobs with `FOR UPDATE SKIP LOCKED`. The handler runs in a savepoint; a failure → `attempts+1`, exponential backoff, `failed` after 5 attempts. Delivery is at-least-once, so handlers are idempotent (`notifications.job_id` UNIQUE).
- **Rejected:** notifying inside the request (lost on crash, or sent for a rolled-back change); a message queue (can't join the Postgres transaction).
- **Cost:** up to about 1 s delay; `failed` jobs need manual attention.

## 6. Lists, search and indexes

- **Chose:** keyset pagination on `(created_at DESC, id DESC)`, with `id` breaking ties. Indexes match each query: team+created, team+status, team+priority, assignee, a partial index for unassigned urgent. **Search** = Postgres full-text (generated `tsvector`, `websearch_to_tsquery`: word forms, `"phrase"`, `-exclude`) OR a trigram `ILIKE` for partial words.
- **Measured** (`npm run explain`, 20k items, warm): every one-team query takes **0.5–7 ms** using the intended index. For the four-team Admin, the list uses a sequential scan (about 19 ms), which is Postgres's cheapest plan when a user sees every row.
- **Rejected:** OFFSET (slow, and skips or repeats rows on inserts); Elasticsearch (another system; not needed yet).
- **Cost:** no page numbers or totals; multi-team lists sort rather than read an index in order.

## 7. Live updates: a streamed response, not websockets

- **Chose:** `GET /items/:id/live` (`text/event-stream`) checks the item's version and latest event every 1.5 s and sends `change`. The client then refetches through the normal permission-checked endpoints, so **the stream carries no data**. It's read with `fetch` (`EventSource` can't send the auth header), closes after 25 s, and reconnects. 10 s polling stays as a fallback.
- **Rejected:** websockets (connection state, poor fit for serverless); LISTEN/NOTIFY (needs a long-lived connection per stream, which Neon's pooler doesn't allow).
- **Cost:** one small query per open item every 1.5 s. Lists and the dashboard still poll (15 s).

## 8. Running it: Docker locally, Vercel live

- **Docker:** nginx (React app + `/api` proxy), API, worker, Postgres. Migrations and seed run on boot.
- **Vercel:** the same Express app as **one function** (`server/src/vercel.ts`), Neon Postgres, in Singapore next to the DB. **No worker process:** after each write the function drains the outbox after the response is sent (`waitUntil`), still with `SKIP LOCKED`.
- **Cost on Vercel:** a failed job retries on the next write, not after its backoff.

## 9. Operational basics

- **Logging:** one JSON line per request with an `X-Request-Id` (`logger.ts`). A 500 returns the id, never the error.
- **Login rate limit:** 5 failures per email per 15 min → 429 + `Retry-After`. Stored in Postgres so it holds across instances. Same 401 for wrong password and unknown email.
- **Plain SQL with `pg`** (no ORM), so every concurrency-critical statement is visible. `zod` validates input. A 40-line migration runner with an advisory lock.

## Testing

**85 server tests** against real Postgres (they refuse any DB not ending in `_test`) and **4 Playwright tests**: optimistic update, rollback on 409 and on 403, live update. CI runs type checks and the server tests on every push. The race scripts (`scripts/race-*.sh`) show the 200/409 split by hand.

## Known limitations

- Idempotency keys and `done` outbox jobs are never cleaned up.
- No reassign/unassign; `failed` jobs and notifications have no admin UI or read state.
- JWT in `localStorage`, 8 h, no refresh/revocation. Rate limit is per email, not per IP.
- Search is newest first, not ranked (ranking breaks keyset pagination); English only, no typo tolerance.
- Activity history isn't paginated; lists have no total count.
- Browser tests cover the critical flows only, and need the app running.

## Next week

1. Cleanup jobs (idempotency keys, old outbox rows) and a retry button for `failed` jobs.
2. Lead-only reassign/unassign, using the same conditional-update pattern.
3. Index-friendly multi-team lists (one query per team, merged), then load-test at 1M items.
4. Auth: httpOnly cookie, short-lived tokens with refresh, per-IP limits.
5. Metrics on top of the logs: latency, 409 rate, outbox lag. Run the Playwright tests in CI.

## At 10× scale

Partition `activity_events` by month and add read replicas; feed a real queue from the outbox; LISTEN/NOTIFY or pub/sub for live updates; OpenSearch only if ranking and typo tolerance are needed.

---
References: transaction pattern after jajego/interlock, testing after edwardmagongo/LedgerAPI, product shape after TicketForge. No code copied.
