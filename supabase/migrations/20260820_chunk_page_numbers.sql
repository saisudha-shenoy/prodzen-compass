-- In-document highlighting (Part 1): a page_number per chunk, for PDFs only
-- (DOCX has no native page concept in the file format, so this stays null
-- for non-PDF documents — the viewer falls back to full-document text
-- search for those). Nullable and additive: existing rows default to null
-- until the backfill script populates them for already-ingested PDFs.
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS page_number int;

-- Both retrieval RPCs now also return page_number so the app can offer a
-- direct page-jump for PDF results without falling back to full-document
-- text search every time. No other column, filter, or ordering logic
-- touched in either function.
-- Adding a column to the return table changes the function's row type, which
-- CREATE OR REPLACE cannot do in place — Postgres requires the old signature
-- dropped first.
DROP FUNCTION IF EXISTS match_chunks(halfvec, int, text, text, text, text, date, date);

CREATE OR REPLACE FUNCTION match_chunks(
  query_embedding halfvec,
  match_count int DEFAULT 5,
  filter_client text DEFAULT NULL,
  filter_document_type text DEFAULT NULL,
  filter_author text DEFAULT NULL,
  filter_topic_category text DEFAULT NULL,
  filter_date_from date DEFAULT NULL,
  filter_date_to date DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  document_id uuid,
  content text,
  chunk_index int,
  page_number int,
  similarity double precision,
  title text,
  client text,
  document_type text,
  author text,
  date_created date,
  topic_category text
)
LANGUAGE sql STABLE
AS $$
  select
    c.id as chunk_id,
    c.document_id,
    c.content,
    c.chunk_index,
    c.page_number,
    1 - (c.embedding <=> query_embedding) as similarity,
    d.title,
    d.client,
    d.document_type,
    d.author,
    d.date_created,
    d.topic_category
  from chunks c
  join documents d on d.id = c.document_id
  where (filter_client is null or d.client = filter_client)
    and (filter_document_type is null or d.document_type = filter_document_type)
    and (filter_author is null or d.author = filter_author)
    and (filter_topic_category is null or d.topic_category = filter_topic_category)
    and (filter_date_from is null or d.date_created >= filter_date_from)
    and (filter_date_to is null or d.date_created <= filter_date_to)
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

DROP FUNCTION IF EXISTS keyword_search_chunks(text, int, text, text, text, text, text, text);

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
  page_number int,
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
    c.page_number,
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
