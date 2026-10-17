-- Invariant: an item has no assignee exactly when it is Open.
-- Claiming is the only way out of Open, and it sets the assignee in the same UPDATE.
-- The database rejects any write that would break this, even if app code has a bug.
ALTER TABLE work_items
  ADD CONSTRAINT work_items_open_iff_unassigned CHECK ((status = 'open') = (assignee_id IS NULL));

-- For 'edited' events: which field changed (title, description, due_date).
ALTER TABLE activity_events ADD COLUMN field TEXT;

-- JSONB re-orders object keys; plain JSON keeps the exact text, so a replayed
-- idempotent response is byte-for-byte the same as the original.
ALTER TABLE idempotency_keys ALTER COLUMN response_body TYPE JSON;
