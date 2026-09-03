-- Saved Search (Search tab feature): lets a user save the current query +
-- filter combination under a short name and replay it later with one click.
-- Mirrors activity_log's own query/filters column split for consistency —
-- query is free text, filters is a jsonb snapshot of the exact Search-tab
-- filter state (client/type/author/topic/format/date range) needed to
-- restore the tab to how it looked when saved.
CREATE TABLE IF NOT EXISTS saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  query text,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The tab lists saved searches newest-first.
CREATE INDEX IF NOT EXISTS saved_searches_created_at_idx ON saved_searches (created_at DESC);
