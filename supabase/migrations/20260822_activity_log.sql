-- Activity Log: records every real Search and Ask call (not sampled) for
-- the new "Activity Log" tab's table view + CSV export.
--
-- filters vs. (retrieved_chunk_ids + citations + answer) are deliberately
-- either/or per row rather than separate tables: Search rows populate
-- filters and leave the Ask-only columns null; Ask rows populate
-- retrieved_chunk_ids/citations/answer and leave filters null. A single
-- table keeps both a time-ordered feed and CSV export trivial (one query,
-- one export), which a Search/Ask split would complicate for little benefit
-- at this app's scale.
CREATE TABLE IF NOT EXISTS activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL CHECK (type IN ('search', 'ask')),
  query text,
  filters jsonb,
  retrieved_chunk_ids jsonb,
  citations jsonb,
  answer text,
  latency_ms integer,
  feedback text CHECK (feedback IN ('helpful', 'not_helpful'))
);

-- The tab's date-range filter and CSV export both query by created_at range
-- (and the export additionally scopes by type in the UI's summary counts).
CREATE INDEX IF NOT EXISTS activity_log_created_at_idx ON activity_log (created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_type_idx ON activity_log (type);
