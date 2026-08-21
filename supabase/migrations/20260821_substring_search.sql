-- Substring search (Part C, additive to the hybrid search added in
-- 20260819_hybrid_search.sql): a third, independent qualification path for
-- partial/truncated terms.
--
-- websearch_to_tsquery() (the existing keyword path) matches STEMMED
-- lexemes, not raw substrings — Postgres's English stemmer often produces a
-- lexeme SHORTER than a partial word a user is still typing, e.g.
-- to_tsvector('english', 'sustainability') stores 'sustain', and
-- to_tsvector('english', 'irrigation') stores 'irrig'. A prefix search on
-- the raw query text ('sustainab:*') can never match a stored lexeme that's
-- shorter than the query itself, no matter which direction the prefix
-- operator points — this is a structural property of stemming, not a
-- tunable threshold. Plain substring (ILIKE) matching against the
-- unstemmed chunk content sidesteps stemming entirely, so a truncated word
-- like "sustainab" or "irrigat" still finds "sustainability"/"irrigation".
--
-- Patterns are built application-side (see substringSearchChunks in
-- lib/retrieval.js) — one '%word%' pattern per query word — and passed in
-- as an array; ILIKE ALL(patterns) requires every word to appear somewhere
-- in the chunk (AND semantics, matching how the other two paths treat
-- multi-word queries), just via substring rather than stemmed-lexeme or
-- embedding matching.
CREATE OR REPLACE FUNCTION substring_search_chunks(
  patterns text[],
  match_count int DEFAULT 20,
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
    d.title,
    d.client,
    d.document_type,
    d.author,
    d.date_created::text AS date_created,
    d.topic_category
  FROM chunks c
  JOIN documents d ON d.id = c.document_id
  WHERE c.content ILIKE ALL(patterns)
    AND (filter_client IS NULL OR d.client = filter_client)
    AND (filter_document_type IS NULL OR d.document_type = filter_document_type)
    AND (filter_author IS NULL OR d.author = filter_author)
    AND (filter_topic_category IS NULL OR d.topic_category = filter_topic_category)
    AND (filter_date_from IS NULL OR d.date_created::text >= filter_date_from)
    AND (filter_date_to IS NULL OR d.date_created::text <= filter_date_to)
  ORDER BY d.date_created DESC
  LIMIT match_count;
$$;
