-- Full-text search over title + description.
-- GENERATED ... STORED: Postgres computes this column itself on every insert/update,
-- so no application code can forget to keep it in sync.
-- to_tsvector('english', ...) splits text into words and reduces them to their root
-- ("refunds", "refunded" -> "refund"). Title words get weight A, description words B.
ALTER TABLE work_items ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', title), 'A') ||
    setweight(to_tsvector('english', description), 'B')
  ) STORED;

-- GIN index: maps each word to the rows that contain it, so a search doesn't read every row.
CREATE INDEX work_items_search_idx ON work_items USING gin (search_vector);
