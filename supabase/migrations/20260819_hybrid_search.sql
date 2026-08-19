-- Hybrid search (Part A): Postgres full-text search path, additive only.
-- Does not touch chunks.embedding, the hnsw index, or match_chunks() at all.

-- 1. Generated tsvector column over chunks.content, kept in sync automatically
--    by Postgres (STORED = computed once at write time, not per query).
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english', content)) STORED;

-- 2. GIN index for fast @@ matching.
CREATE INDEX IF NOT EXISTS chunks_content_tsv_idx ON chunks USING GIN (content_tsv);

-- 3. Keyword-search RPC, mirroring match_chunks()'s filter signature exactly
--    so the JS layer can call both with the same filters object. Returns
--    ts_rank instead of cosine similarity; date columns are cast to/compared
--    as text to stay agnostic to the underlying column type.
CREATE OR REPLACE FUNCTION keyword_search_chunks(
  query_text text,
  match_count int,
  filter_client text DEFAULT NULL,
  filter_document_type text DEFAULT NULL,
  filter_author text DEFAULT NULL,
  filter_topic_category text DEFAULT NULL,
  filter_date_from text DEFAULT NULL,
  filter_date_to text DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  content text,
  chunk_index int,
  rank real,
  title text,
  client text,
  document_type text,
  author text,
  date_created text,
  topic_category text
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id AS chunk_id,
    c.document_id,
    c.content,
    c.chunk_index,
    ts_rank(c.content_tsv, websearch_to_tsquery('english', query_text)) AS rank,
    d.title,
    d.client,
    d.document_type,
    d.author,
    d.date_created::text AS date_created,
    d.topic_category
  FROM chunks c
  JOIN documents d ON d.id = c.document_id
  WHERE c.content_tsv @@ websearch_to_tsquery('english', query_text)
    AND (filter_client IS NULL OR d.client = filter_client)
    AND (filter_document_type IS NULL OR d.document_type = filter_document_type)
    AND (filter_author IS NULL OR d.author = filter_author)
    AND (filter_topic_category IS NULL OR d.topic_category = filter_topic_category)
    AND (filter_date_from IS NULL OR d.date_created::text >= filter_date_from)
    AND (filter_date_to IS NULL OR d.date_created::text <= filter_date_to)
  ORDER BY ts_rank(c.content_tsv, websearch_to_tsquery('english', query_text)) DESC
  LIMIT match_count;
$$;
