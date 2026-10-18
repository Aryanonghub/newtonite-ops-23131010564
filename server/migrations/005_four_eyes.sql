-- Four-eyes rule: whoever submitted an item for approval cannot approve it themselves.
-- submitted_by is set when an item enters Awaiting Approval and cleared when it leaves.
ALTER TABLE work_items ADD COLUMN submitted_by INT REFERENCES users(id);

-- Items already waiting: the submitter is whoever made that move in the history,
-- falling back to the assignee (who is always the one who submits).
UPDATE work_items w SET submitted_by = COALESCE(
  (SELECT e.actor_id FROM activity_events e
    WHERE e.item_id = w.id AND e.kind = 'status_changed' AND e.to_value = 'awaiting_approval'
    ORDER BY e.id DESC LIMIT 1),
  w.assignee_id)
WHERE w.status = 'awaiting_approval';

-- Invariant: an item has a submitter exactly when it is Awaiting Approval.
ALTER TABLE work_items
  ADD CONSTRAINT work_items_submitted_iff_awaiting CHECK ((status = 'awaiting_approval') = (submitted_by IS NOT NULL));
