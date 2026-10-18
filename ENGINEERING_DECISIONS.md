# Engineering Decisions

This document records the main decisions behind the system: the context, the options I considered,
what I chose, and what that choice costs. The theme throughout: **put correctness rules where they cannot
be bypassed**. That means the database where possible, and the server always, never only the browser.

## Product assumptions

The brief leaves these open on purpose. These are my assumptions; the ones marked ★ are the first I'd check with a product manager.

| Question | Assumption |
|---|---|
| How does an item get an owner? | ★ Only by being **claimed** by a team Member/Lead/Admin. Claiming also moves it Open → In Progress. There is no "assign to someone else" yet. |
| States and moves | Open → In Progress → Awaiting Approval → Resolved → Closed. Plus "Send back" (Awaiting Approval → In Progress) and "Reopen" (Resolved → In Progress). Closed is final. |
| Who can approve? | ★ Lead or Admin **of the item's team**. A Lead in Payments has no rights in Support. |
| Can the assignee approve their own item if they're a Lead? | ★ Yes, currently. A stricter "four-eyes" rule (approver ≠ assignee) would be a one-line change in `workflow.ts`. |
| Who can do other moves, edit and comment? | Any Member, Lead or Admin of the item's team, not only the assignee. |
| Viewer | Read-only within their teams. |
| Admin | A per-team role, at least as strong as Lead. There is no global super-admin. |
| What can PATCH change? | Title, description, priority, due date. Status and assignee change **only** through `/claim` and `/transition`, where the rules live. |
| Who gets notified? | The creator, when someone claims their item. The assignee, when someone else moves their item. |

---

## 1. Data model and history

**Context.** Every change to owner, priority and status must be recorded and visible, and the history must never
disagree with the item, even when requests fail halfway.

**Options considered.**
1. An `activity_events` table written by the application **in the same transaction** as the change.
2. Postgres triggers on `work_items` that write the history automatically.
3. Event sourcing: store only events and compute the current item from them.

**Choice: option 1, made strict by the database.**
- Each write runs inside one transaction (`withTransaction()` in `db.ts`): the conditional `UPDATE`, then
  `INSERT INTO activity_events`, then `COMMIT`. A 403/409/422 or a crash rolls back both.
- A trigger makes `activity_events` **append-only**: `UPDATE`/`DELETE` raise an error, even from a psql session.
- A `CHECK` constraint enforces the invariant *"an item has no assignee exactly when it is Open"*, so buggy
  code cannot create an inconsistent item.
- Each event stores `kind`, `field`, `from_value`, `to_value`, `actor_id`, and the comment for comment events.
- Allowed values use `CHECK` constraints instead of Postgres `ENUM` types, because they're easier to change in a migration.

**Trade-off.** Every write path must remember to call `recordEvent()`. A trigger (option 2) can't forget,
but it doesn't know *who* acted or *why* without extra session variables, and it hides logic from code
review. Event sourcing (option 3) gives perfect history but makes every read harder; too much for this scope.
`from_value`/`to_value` are plain text: simple, but not typed.

## 2. Concurrency: optimistic locking and conditional updates

**Context.** Two people may claim the same item at the same moment, and an editor may save over changes they
never saw.

**Options considered.**
1. **Pessimistic locking:** `SELECT ... FOR UPDATE` before changing a row, so other writers wait.
2. **Optimistic locking:** a `version` column. The client sends the version it saw; the server updates with
   `WHERE id = $1 AND version = $2` and increments it. 0 rows updated → 409 Conflict with the latest item.
3. Check in application code (`if (item.assignee_id) ...`) and then update.

**Choice: optimistic.**
- Claim: `UPDATE ... SET assignee_id = $me ... WHERE id = $1 AND assignee_id IS NULL`.
- PATCH and transition: `WHERE id = $1 AND version = $2`.

Contention on a single ticket is rare, and a user who loses a race should be *told* ("This item changed,
reload"), not made to wait. The condition is inside the `UPDATE`, so check-and-write is one atomic step.
Postgres row-locks the row; the second writer waits for the first, then re-checks the `WHERE` against the
new row and matches 0 rows. There is deliberately **no** JavaScript pre-check. That makes the SQL guard the only
guard, so the test proves it: removing `AND assignee_id IS NULL` makes the claim test fail with `[200, 200]`.

Option 3 is wrong: both requests can read "unassigned" before either writes.

**Trade-off.** On conflict the user must reload and redo their change; nothing is merged automatically.
Pessimistic locking would avoid redoing work, but holds locks across user think-time (impossible over HTTP)
or makes writers queue. The frontend sends the version from **when editing started**, not the latest polled
one, so a background refresh can never silently turn a stale edit into an overwrite.

## 3. Authorization: per-team roles, one permission function

**Context.** Permissions must be enforced on the server, per team and per item. A Lead in one team is a
nobody in another.

**Options considered.**
1. Global roles (one role per user).
2. **Per-team roles** in `memberships (user_id, team_id, role)`, checked by **one function** `can(user, action, item)`.
3. A full permission matrix or policy engine (e.g. a roles × permissions table, or a library such as Casbin).

**Choice: option 2.**
- Roles are ranked viewer < member < lead < admin, and each action has a minimum role. Only `approve` needs Lead.
- `can()` looks only at the user's role **in the item's team**, and every endpoint calls it through `authorize()`.
- List and dashboard queries always start with `WHERE team_id = ANY($myTeams)`, so filtering by an
  unrelated team simply returns nothing.
- **404 vs 403:** a user outside the team gets **404**, so they can't even learn the item exists. A team
  member whose role is too low gets **403** with a reason the UI can show
  (*"Your role in this team (member) cannot approve items"*).
- **Four-eyes:** whoever submitted an item for approval cannot approve it, whatever their role (Admins
  included). The item stores `submitted_by` while it is Awaiting Approval (a CHECK constraint keeps the two
  in step), and the rule lives in `can()` with the role rules, so there is still one place to look.
  Their own submissions are left out of their "Awaiting my approval" list.
- The JWT contains only the user id. Roles are **re-loaded from the database on every request**, so removing
  someone from a team takes effect immediately, not when their token expires. The UI hides buttons as a
  convenience only; I tested this by revoking a role while the page was open, and the server refused.

**Trade-off.** One extra indexed query per request to load roles. A ranked list can't express "Viewers may
comment but not claim"; that would need option 3. For four roles, a 7-line table is easier to read and audit.

## 4. Idempotency for creating items

**Context.** A double-clicked button or a retry after a network timeout must not create two items.

**Options considered.**
1. Disable the button in the UI (not enough: it doesn't help with retries, other clients or the network).
2. Redis with a TTL for seen keys.
3. **An `idempotency_keys` table in Postgres**, used inside the same transaction as the create.

**Choice: option 3.** `POST /items` requires an `Idempotency-Key` header. Step 1 of the transaction is
`INSERT INTO idempotency_keys ... ON CONFLICT DO NOTHING` (primary key `(user_id, key)`):
- **New key:** create the item, store the response, commit, all together.
- **Same key, same request** (a SHA-256 hash of the validated body): return the stored response,
  byte-for-byte (stored as `JSON`, not `JSONB`, which would reorder keys), plus `Idempotent-Replayed: true`.
- **Same key, different request:** 422.
- **Two identical requests at the same time:** the second `INSERT` waits on the primary key until the first
  commits, then replays its response. The test fires 5 at once and gets exactly one item.
- If the request fails (e.g. 403), the rollback also removes the key, so a failed attempt doesn't use it up.

The frontend creates one key per "New item" dialog.

**Trade-off.** Keys never expire (see limitations). It only covers create. Claim and transition are already
safe to retry, because their conditional updates can't apply twice. A retried transition after a lost response
returns 409 instead of replaying the success, which is safe but less friendly.

## 5. Sync vs async: transactional outbox

**Context.** Side effects such as notifying someone shouldn't slow down or break the request. They also must
not be lost, or sent for a change that never committed.

**Options considered.**
1. Do it inside the request: either before commit (notifies about changes that might roll back) or after
   commit (lost if the process crashes in between).
2. A message queue (Redis/BullMQ, SQS). It's a second system, and writing to it can't be part of the Postgres transaction.
3. **Transactional outbox:** insert an `outbox_jobs` row in the same transaction as the change; a worker processes it.

**Choice: option 3.**
- The worker takes one due job with `SELECT ... FOR UPDATE SKIP LOCKED`. Several workers can run without
  ever taking the same job (tested with two workers on 20 jobs).
- It runs the handler inside a **savepoint**. On error it rolls back only the handler's partial writes, keeps
  the lock, and records `attempts + 1`, `last_error` and `run_after = now() + 2^attempts seconds`.
  After `max_attempts` the job is marked `failed`.
- Delivery is *at least once*, so the handler is **idempotent**: `notifications.job_id` is `UNIQUE` and
  inserts use `ON CONFLICT DO NOTHING`. Tested: a job processed twice → one notification.

**Trade-off.** Notifications arrive up to ~1 s late (polling interval), and the worker adds load to Postgres.
Fine at this scale; at much larger scale a dedicated queue fed from the outbox would be better. Jobs marked
`failed` need manual attention. Running the handler while holding the row lock is right for a quick DB
insert, but a slow external call (email API) should instead mark the job "processing" with a lease and commit first.

## 6. Pagination, filtering and indexes

**Context.** Tens of thousands of items and a growing history. The browser must never load everything and filter.

**Options considered.**
1. `LIMIT/OFFSET` pagination. Simple, but gets slower with each page and skips or repeats rows when items are
   inserted between page loads.
2. **Keyset (cursor) pagination** on `(created_at DESC, id DESC)`.
3. A search engine (Elasticsearch/OpenSearch) for search.

**Choice: option 2, plus targeted indexes, plus Postgres full-text search.**
- The cursor is the id of the last item seen, base64-encoded. The next page is
  `WHERE (created_at, id) < (SELECT created_at, id FROM work_items WHERE id = $cursor)`.
  Looking the values up by id avoids precision bugs: JavaScript dates have milliseconds, Postgres has
  microseconds. `id` breaks ties between equal timestamps (tested).
- All filtering runs on the server. Indexes match the queries:
  - `(team_id, created_at DESC, id DESC)`: default list
  - `(team_id, status, ...)` and `(team_id, priority, ...)`: filters
  - `(assignee_id, status)`: "assigned to me"
  - a **partial index** containing only unassigned urgent items, for the dashboard
  - a **trigram GIN index** for `title ILIKE '%text%'`, which a normal B-tree can't serve
  - a **full-text GIN index** on `search_vector`
- **Search** matches if either of two things is true:
  - **Full-text** over title + description: a `search_vector` *generated column* (Postgres keeps it in
    sync itself), queried with `websearch_to_tsquery`. Word order doesn't matter, word forms match
    ("refunds" finds "refund"), and `"exact phrase"` / `-exclude` work.
  - **Partial title match** with `ILIKE`, so typing part of a word ("paym") still finds "payment".
    Full-text only matches whole words.

  Postgres combines both indexes in one plan (`BitmapOr`): about 7 ms on 20,000 items.
- Measured with `EXPLAIN ANALYZE` on the 20,000 seeded items: list and dashboard queries run in under 4 ms.

**Trade-off.**
- There's no "jump to page 37" and no total count. Counting is expensive at scale; the dashboard says
  "top 20" instead of pretending 20 is a total.
- For a user in **many** teams, Postgres can't read one index in order across several `team_id` values, so
  it reads the matching rows and sorts them. Today that means a sequential scan when a user sees half the table.
  At 10× scale I'd fix this with one indexed query per team merged together, or a different index design.

## 7. What I chose not to build

- **Websockets.** Polling every 10–15 s (plus refetch on window focus) is enough for an internal tool and has
  no connection state to manage. The item page shows the latest version, and any conflict is caught by the version check anyway.
- **Reassign / unassign, SLAs, attachments, email, SSO, sign-up, mobile.** Out of scope per the brief.
  Reassignment would be a new `assign` action (Lead+) using the same conditional-update pattern.
- **An ORM.** Plain SQL with `pg`, so every concurrency-critical statement is visible and reviewable. Validation uses `zod`.
- **A migration library.** A 40-line runner applies `migrations/*.sql` in order, each in a transaction, with
  an advisory lock so two containers can't migrate at once.
- **A full frontend test suite.** Three Playwright tests cover what matters most in the UI: the optimistic
  update, the rollback on 409 (two real browser logins) and on 403, and that no false success message
  appears. Everything else was checked by hand. Most of the testing time went into server-side tests,
  where the correctness rules live.

---

## Known limitations

- **Idempotency keys never expire.** The table grows forever; it needs a scheduled cleanup (e.g. delete keys older than 24 h).
- Idempotency covers only `POST /items`. A retried transition whose first response was lost returns 409 instead of the original success.
- No reassign/unassign; an item's owner can only change by claiming it while Open.
- The assignee can approve their own item if they are a Lead (no four-eyes rule).
- JWT in `localStorage` (readable by any injected script), 8-hour expiry, no refresh token, no revocation list, no login rate limiting.
- Search results are sorted newest first, not by relevance. Ranking (`ts_rank`) would need a different cursor,
  because keyset pagination needs a stable sort order. English stemming only; no typo tolerance.
- `GET /items/:id/activity` returns the whole history without pagination.
- Lists have no total count; dashboard panels show at most 20 items.
- Notifications are in-app only, with no read/unread state. `failed` outbox jobs have no retry UI.
- For users in many teams, list queries sort the matching rows instead of reading an index in order (see decision 6).
- IDs are 32-bit integers (about 2.1 billion rows), which is plenty here but would need `BIGINT` for the activity table at very large scale.
- The compose file has a dev-only default `JWT_SECRET`. Real deployments must set their own.
- Browser tests cover only the optimistic-update flows. They also need the app running (`docker compose up`), unlike the server tests.

## Next week I would…

1. Add a scheduled cleanup for idempotency keys and old `done` outbox jobs, and a small admin view to retry `failed` jobs.
2. Add Lead-only **reassign/unassign** with the same conditional-update pattern and its own tests.
3. Extend the Playwright tests to the main pages (create, filters, comments) and run both test suites in CI on every push.
4. Paginate the activity endpoint and add read/unread notifications.
5. Make multi-team list queries index-friendly (one query per team, merged), then load-test with 1M items and `EXPLAIN ANALYZE`.
6. Harden auth: httpOnly cookie instead of `localStorage`, short-lived tokens with refresh, login rate limiting.
7. Add structured logs with a request id and basic metrics (request latency, 409 rate, outbox lag).

## At 10× scale

- Partition `activity_events` by month (it grows fastest), and add read replicas for list and dashboard reads.
- Move search to OpenSearch if relevance ranking and typo tolerance are needed. Postgres full-text search is fine until then.
- Feed a dedicated queue from the outbox if job volume or slow handlers outgrow polling.
- Replace polling with server-sent events or websockets for the item page.

## References

Transaction pattern inspired by jajego/interlock; testing approach inspired by edwardmagongo/LedgerAPI;
product shape inspired by TicketForge. No code was copied from these projects.
