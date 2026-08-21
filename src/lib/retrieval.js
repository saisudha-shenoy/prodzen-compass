import OpenAI from "openai";
import { supabaseAdmin } from "./supabase.js";

const EMBEDDING_MODEL = "text-embedding-3-large";
const DEFAULT_MATCH_COUNT = 8;

export async function retrieveChunks(query, filters = {}, matchCount = DEFAULT_MATCH_COUNT) {
  let queryEmbedding;
  try {
    const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openaiClient.embeddings.create({
      model: EMBEDDING_MODEL,
      input: query,
    });
    queryEmbedding = response.data[0].embedding;
  } catch (err) {
    throw new Error(`Failed to embed query: ${err.message}`);
  }

  const { data, error } = await supabaseAdmin.rpc("match_chunks", {
    query_embedding: queryEmbedding,
    match_count: matchCount,
    filter_client: filters.client ?? null,
    filter_document_type: filters.documentType ?? null,
    filter_author: filters.author ?? null,
    filter_topic_category: filters.topicCategory ?? null,
    filter_date_from: filters.dateFrom ?? null,
    filter_date_to: filters.dateTo ?? null,
  });

  if (error) {
    throw new Error(`match_chunks query failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    content: row.content,
    chunkIndex: row.chunk_index,
    pageNumber: row.page_number,
    similarity: row.similarity,
    title: row.title,
    client: row.client,
    documentType: row.document_type,
    author: row.author,
    dateCreated: row.date_created,
    topicCategory: row.topic_category,
  }));
}

// Ask questions are full sentences ("Explain the nidhi scheme in India"),
// not bare keyword queries — but websearch_to_tsquery() (keyword path) and
// ILIKE ALL() (substring path, below) both AND every word together, so a
// framing word that never literally appears in the source document (e.g.
// "explain") silently blocks a match on a real, present term (e.g.
// "nidhi") even though the actual content is right there. Confirmed
// directly: "Explain nidhi scheme in India" found 0 keyword/substring
// candidates against India_Hospitality_Market_Report.pdf, which contains
// "NIDHI" verbatim; stripping "explain"/"in" alone found it. Semantic
// search doesn't have this problem (embeddings handle natural phrasing
// contextually), so this stripping is scoped to only these two paths — the
// two paths that literally require every surviving word to appear in the
// text.
const QUESTION_STOP_WORDS = new Set([
  "explain", "describe", "define", "discuss", "summarize", "summarise", "elaborate",
  "tell", "give", "provide", "list", "show", "find", "identify", "outline",
  "what", "whats", "how", "why", "who", "whom", "which", "when", "where",
  "is", "are", "was", "were", "do", "does", "did", "can", "could", "would", "should", "will", "shall",
  "the", "a", "an", "of", "in", "on", "at", "for", "to", "and", "or", "about", "me", "us", "please",
]);

// Falls back to the original query if stripping would leave nothing (e.g. a
// query that's entirely framing words) — better to run the original,
// probably-still-empty query than to send an empty string to Postgres.
function stripQuestionFraming(query) {
  const kept = query.split(/\s+/).filter((word) => !QUESTION_STOP_WORDS.has(word.toLowerCase().replace(/[^a-z0-9]/g, "")));
  return kept.length > 0 ? kept.join(" ") : query;
}

// Postgres full-text keyword search over chunks.content, independent of the
// semantic (embedding) path — see keyword_search_chunks() in
// supabase/migrations/20260819_hybrid_search.sql. Mirrors match_chunks()'s
// filter signature exactly so callers can pass the same filters object to
// both. Returns ts_rank instead of cosine similarity; no embedding call.
export async function keywordSearchChunks(query, filters = {}, matchCount = DEFAULT_MATCH_COUNT) {
  const { data, error } = await supabaseAdmin.rpc("keyword_search_chunks", {
    query_text: stripQuestionFraming(query),
    match_count: matchCount,
    filter_client: filters.client ?? null,
    filter_document_type: filters.documentType ?? null,
    filter_author: filters.author ?? null,
    filter_topic_category: filters.topicCategory ?? null,
    filter_date_from: filters.dateFrom ?? null,
    filter_date_to: filters.dateTo ?? null,
  });

  if (error) {
    throw new Error(`keyword_search_chunks query failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    content: row.content,
    chunkIndex: row.chunk_index,
    pageNumber: row.page_number,
    rank: row.rank,
    title: row.title,
    client: row.client,
    documentType: row.document_type,
    author: row.author,
    dateCreated: row.date_created,
    topicCategory: row.topic_category,
  }));
}

// Substring matching (Part C, additive to the hybrid keyword path above) —
// see substring_search_chunks() in supabase/migrations/20260821_substring_search.sql
// for why this exists: Postgres's stemmer can shorten a word (e.g.
// "sustainability" -> 'sustain', "irrigation" -> 'irrig'), so a truncated
// query like "sustainab" or "irrigat" can never prefix-match the stored
// stemmed lexeme, no matter which threshold is used. Plain ILIKE substring
// matching against the raw chunk text sidesteps stemming entirely. Patterns
// are built here (one '%word%' per query word, 3+ chars to skip noise like
// "in"/"of", and excluding QUESTION_STOP_WORDS to skip natural-language
// framing like "explain" — see that constant's comment) rather than in SQL,
// so the escaping/splitting logic lives in one place and stays easy to test.
export async function substringSearchChunks(query, filters = {}, matchCount = DEFAULT_MATCH_COUNT) {
  const patterns = Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/\s+/)
        .map((word) => word.replace(/[^a-z0-9]/g, ""))
        .filter((word) => word.length >= 3 && !QUESTION_STOP_WORDS.has(word))
    )
  ).map((word) => `%${word.replace(/[%_\\]/g, "\\$&")}%`);

  if (patterns.length === 0) return [];

  const { data, error } = await supabaseAdmin.rpc("substring_search_chunks", {
    patterns,
    match_count: matchCount,
    filter_client: filters.client ?? null,
    filter_document_type: filters.documentType ?? null,
    filter_author: filters.author ?? null,
    filter_topic_category: filters.topicCategory ?? null,
    filter_date_from: filters.dateFrom ?? null,
    filter_date_to: filters.dateTo ?? null,
  });

  if (error) {
    throw new Error(`substring_search_chunks query failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    content: row.content,
    chunkIndex: row.chunk_index,
    pageNumber: row.page_number,
    title: row.title,
    client: row.client,
    documentType: row.document_type,
    author: row.author,
    dateCreated: row.date_created,
    topicCategory: row.topic_category,
  }));
}

export function hasAnyFilter(filters) {
  return Object.values(filters).some((value) => value !== undefined && value !== null && value !== "");
}

// Relevance cutoff, recalibrated against the real ~20-document corpus (the
// old flat MIN_SIMILARITY = 0.25 was calibrated against a 2-document sample
// and produced two opposite failure modes at real scale: narrow queries
// returned noise the fixed threshold couldn't see was noise, and broad
// queries either pulled in unrelated documents or dropped genuinely relevant
// ones, depending on where 0.25 happened to fall relative to that query's
// own score spread).
//
// A single fixed threshold cannot separate relevant from noise across query
// types, because "relevant" sits at very different absolute scores depending
// on how many documents are actually about the topic:
//   - Narrow queries with one dominant document show a large gap after rank
//     1, e.g. "chemical products in Europe": 0.57 -> next document 0.36 (a
//     0.21 gap). "irrigation methods...": 0.69 -> 0.38 (a 0.31 gap).
//   - Broad queries with several genuinely relevant documents show a much
//     flatter top tier before the real cliff, e.g. "Aegean Resorts
//     sustainability certification": the 4 truly relevant documents span
//     0.63 down to 0.53 (a 0.10 spread) before a cliff to 0.36 noise.
//     "Meridian Textiles ESG compliance": 5 relevant documents span 0.61
//     down to 0.48 before a cliff to 0.47 noise.
//   - Weak/ambiguous queries have no real signal at all: "RACI matrix..."
//     tops out at just 0.39, with a flat, undifferentiated tail down to
//     0.31 — nothing here is confidently relevant, including the nominal
//     top hit (which was, in testing, the WRONG document; the correct one
//     ranked 2nd at 0.384, essentially tied with it).
//   - True noise (queries genuinely unrelated to the corpus) tops out
//     around 0.15-0.27 across every unrelated query tested ("Dell laptops",
//     "best pizza recipes", "how do car engines work") — comfortably below
//     every genuine query's top score, including the weak RACI case.
//
// This is why a relative approach (include documents within a margin of the
// query's own top score) fits the data better than any fixed number: it
// adapts to whether a query has one dominant match or several. RELEVANCE_MARGIN
// is set to 0.14 — wide enough to keep every document in the broad queries'
// flatter top tiers (0.10-0.13 spreads) without also reaching the noise
// documents just past their cliffs (0.10-0.21 gaps). ABSOLUTE_FLOOR = 0.37
// sits between the true-noise ceiling (~0.27) and the weakest real query's
// top score (~0.39), so a query whose best match doesn't clear it returns
// nothing, and it also trims RACI-style flat, undifferentiated tails down
// near its own top score even though the margin alone wouldn't.
//
// Known remaining gap: a document that's genuinely relevant but scores far
// below the query's dominant match (e.g. irrigation's 2nd document at 0.38
// vs. the top document's 0.69 — a 0.31 gap, comparable to some documents
// this same margin correctly treats as noise) isn't rescued by this or any
// single fixed-margin/fixed-floor scheme: any margin generous enough to
// reach it would also swallow flat, low-confidence tails like RACI's.
// Fixing that would need query-adaptive or multi-signal ranking, not just a
// threshold — out of scope here.
//
// RECALIBRATED for text-embedding-3-large (migrated from text-embedding-3-small;
// the 3072-dim embeddings, stored as halfvec for hnsw indexing, produce a
// compressed/lower cosine similarity range than the old model for these same
// queries). Measured directly against the 10-keyword benchmark corpus
// (scripts/benchmark-retrieval.mjs), comparing raw unfiltered similarity
// scores for ground-truth-relevant documents (TP) vs. everything else (TN)
// across all 10 keywords (27 TP scores, 193 TN scores total):
//   - No single floor cleanly separates all TP from all TN under the new
//     model either (global min(TP) = 0.18, global max(TN) = 0.51) — same
//     structural reason as above, unchanged by the migration.
//   - The old floor (0.37) excluded 15/27 true positives for only a 5/193 TN
//     noise floor — a bad trade. Two of the three keywords that returned zero
//     results post-migration ("financial statement" TP top-score 0.3535,
//     "Gulf Horizon" TP top-score 0.3652) are each the correct, uncontested
//     #1 raw candidate for their query with no nearby noise (2nd-place scores
//     0.1980 and 0.2809) — they were being discarded purely because the new
//     model's raw scores run lower than the old floor assumed, not because
//     retrieval or ranking is wrong.
//   - 0.35 is the lowest floor that captures both of those cleanly (zero
//     added noise for those two specific keywords) while only adding 2 more
//     TN leaks globally (7 vs 5) and rescuing 6 more true positives overall
//     (9 vs 15 excluded) as of this measurement.
//   - The third zero-result keyword ("Watershed") is NOT a floor problem and
//     wasn't chased down here: its top raw candidate (0.3223) is itself a
//     false positive, ranked above both real ground-truth documents (0.2779,
//     0.2523). No floor or margin value can fix that — thresholds only
//     add/remove candidates, they can't reorder them — so a floor low enough
//     to admit the true positives would also admit the wrong top document
//     alongside them. That's a ranking/chunking question for a future pass,
//     not a threshold-calibration one.
//   - RELEVANCE_MARGIN left unchanged at 0.14: it was never the binding
//     constraint in any of the three failing keywords (floor was stricter
//     than margin in each case); the one place margin still visibly limits
//     recall (cotton irrigation's 2nd document, 0.31 below its dominant
//     match) is the same pre-existing, explicitly-accepted gap described
//     above for the old model, not a new regression from the migration.
//
// INVESTIGATED AND REJECTED (do not re-attempt without new data): after the
// 0.37->0.35 floor recalibration above, two unfiltered queries picked up
// false positives ("UAE real estate" returns 2 irrelevant docs instead of 0;
// "RevPAR" precision dropped to 0.333). This looked like a margin problem,
// but swept RELEVANCE_MARGIN in {0.14, 0.10, 0.08, 0.05, 0.03} against the
// full 10-keyword benchmark and neither failure changed at ANY tested value,
// while ESG's recall collapsed (0.667 -> 0.167) and compliance framework's
// did too (0.600 -> 0.000 at the tightest values). Root cause for each:
//   - RevPAR is FLOOR-bound, not margin-bound: topScore - 0.14 = 0.2324,
//     already below ABSOLUTE_FLOOR = 0.35, so the floor alone admits both
//     false positives (0.3672, 0.3632) regardless of margin's value.
//   - UAE real estate's two false positives sit only 0.022 apart (0.5057 vs
//     0.4837) — separating them needs a margin tighter than 0.022, far
//     below the 0.10-0.13 spreads legitimate multi-document queries need
//     (see the original comment above), so no viable margin value can fix
//     this without breaking those cases first.
// Both are downstream of ABSOLUTE_FLOOR / noise-gap structure, not
// RELEVANCE_MARGIN — fixing them needs a floor change or per-query logic,
// not this knob.
const RELEVANCE_MARGIN = 0.14;
const ABSOLUTE_FLOOR = 0.35;

const KEYWORD_MATCH_COUNT = 20;
// keyword_search_chunks() already gates on `@@` (the term must actually
// appear in the chunk via tsquery matching) before ts_rank is computed at
// all, so ts_rank here is mostly an ordering signal, not a second pass/fail
// gate on top of a real match. MIN_KEYWORD_RANK is set low (0.01) so it only
// screens out the small number of technically-matching-but-negligible edge
// cases (e.g. a single occurrence of a common word buried in a long chunk),
// not real matches on the short, low-noise proper-noun/acronym queries this
// path targets.
const MIN_KEYWORD_RANK = 0.01;
const SUBSTRING_MATCH_COUNT = 20;

// Raw chunk-level candidates fetched from match_chunks before any relevance
// filtering. This used to be 8 (retrieveChunks's own DEFAULT_MATCH_COUNT),
// which was a real bug, not just a tuning knob: match_chunks ranks chunks
// globally, not per-document, so a single chunk-heavy document (e.g. a
// 9-chunk spreadsheet that scores moderately against nearly every query)
// can fill most or all of an 8-slot window and crowd out a genuinely
// relevant document's single best chunk before it's ever seen — no
// similarity threshold downstream can recover a chunk that was never
// fetched. Empirically, "irrigation methods used in cotton farming" put the
// correct 2nd document's best chunk at raw rank 11 (the dominant document
// alone filled ranks 1-10). 20 gives comfortable headroom for this corpus's
// chunkiest documents while staying cheap for a ~20-doc knowledge base.
const RAW_CANDIDATE_COUNT = 20;

// Shared retrieval pipeline used by both /api/search and /api/ask — the
// exact same threshold/hybrid/substring qualification logic, so the two
// surfaces never drift apart in what counts as "relevant" (previously
// /api/ask used a raw top-6 chunk fetch with no threshold, hybrid keyword,
// or substring path at all, so it regularly missed documents /api/search
// found for the identical query — see e.g. the ESG_Reporting_Software_
// Competitor_Analysis.xlsx case: Search's DEFAULT_MATCH_COUNT=20 raw fetch
// found it comfortably within threshold; Ask's old top-6 fetch didn't even
// retrieve its chunk as a raw candidate).
//
// Returns chunks pre-ordered by the hybrid ranking rule: semantic-qualifying
// chunks in their existing similarity order, then keyword-only-qualifying
// chunks in ts_rank order, then substring-only-qualifying chunks last (no
// natural rank of their own — substring matching is a last-resort net for
// partial/truncated terms, not a primary ranking signal).
export async function getRelevantChunks(query, filters = {}) {
  const chunks = await retrieveChunks(query, filters, RAW_CANDIDATE_COUNT);

  // Relative to this query's own top score, not a flat number — see the
  // ABSOLUTE_FLOOR/RELEVANCE_MARGIN comment above for why. Exception: when a
  // metadata filter is already applied, the candidate pool can shrink to
  // just 1-2 documents, making "the top score in this small set" an unstable
  // reference point — a genuinely relevant 2nd document can get discarded
  // purely because the filtered pool is small, not because it's a weak
  // match. A user who already narrowed the search with a filter shouldn't
  // then have a relative-ranking rule silently override that and return
  // nothing. So RELEVANCE_MARGIN is skipped whenever a filter is present;
  // ABSOLUTE_FLOOR still applies regardless — it's a sanity floor against
  // true noise, not the mechanism causing this bug.
  const topScore = chunks.length ? Math.max(...chunks.map((chunk) => chunk.similarity)) : 0;
  const threshold = hasAnyFilter(filters) ? ABSOLUTE_FLOOR : Math.max(topScore - RELEVANCE_MARGIN, ABSOLUTE_FLOOR);
  const semanticQualified = chunks.filter((chunk) => chunk.similarity >= threshold);

  // Keyword path: independent of, and additive to, the semantic filtering
  // above. Failure here degrades to semantic-only results rather than
  // failing the request — this path is a supplement, not a dependency.
  let keywordQualified = [];
  try {
    const keywordChunks = await keywordSearchChunks(query, filters, KEYWORD_MATCH_COUNT);
    keywordQualified = keywordChunks.filter((chunk) => chunk.rank > MIN_KEYWORD_RANK);
  } catch (err) {
    console.error(`Keyword search failed, continuing without it: ${err.message}`);
  }

  const semanticIds = new Set(semanticQualified.map((chunk) => chunk.chunkId));
  const keywordOnly = keywordQualified
    .filter((chunk) => !semanticIds.has(chunk.chunkId))
    .sort((a, b) => b.rank - a.rank);

  // Substring path: same additive/never-removes principle as the keyword
  // path above, for partial/truncated terms the stemmed keyword path can't
  // reach (see substringSearchChunks's comment).
  let substringQualified = [];
  try {
    substringQualified = await substringSearchChunks(query, filters, SUBSTRING_MATCH_COUNT);
  } catch (err) {
    console.error(`Substring search failed, continuing without it: ${err.message}`);
  }

  const qualifiedIds = new Set([...semanticIds, ...keywordOnly.map((chunk) => chunk.chunkId)]);
  const substringOnly = substringQualified.filter((chunk) => !qualifiedIds.has(chunk.chunkId));

  return [...semanticQualified, ...keywordOnly, ...substringOnly];
}

// Pure metadata filtering, no query to embed or rank against — used when the
// user sets filters without typing a search query ("browse by filter").
// Queries the documents table directly rather than match_chunks (which
// requires a query_embedding to order by), so there's no similarity score;
// results are ordered by date_created instead.
export async function browseDocuments(filters = {}, limit = DEFAULT_MATCH_COUNT) {
  let query = supabaseAdmin
    .from("documents")
    .select("id, title, client, document_type, author, date_created, topic_category")
    .order("date_created", { ascending: false })
    .limit(limit);

  if (filters.client) query = query.eq("client", filters.client);
  if (filters.documentType) query = query.eq("document_type", filters.documentType);
  if (filters.author) query = query.eq("author", filters.author);
  if (filters.topicCategory) query = query.eq("topic_category", filters.topicCategory);
  if (filters.dateFrom) query = query.gte("date_created", filters.dateFrom);
  if (filters.dateTo) query = query.lte("date_created", filters.dateTo);

  const { data: documents, error } = await query;
  if (error) {
    throw new Error(`Document browse query failed: ${error.message}`);
  }
  if (!documents || documents.length === 0) {
    return [];
  }

  // One representative chunk per document for the result snippet.
  const { data: chunkRows, error: chunkError } = await supabaseAdmin
    .from("chunks")
    .select("document_id, content")
    .in(
      "document_id",
      documents.map((d) => d.id)
    )
    .eq("chunk_index", 0);
  if (chunkError) {
    throw new Error(`Chunk lookup for browse failed: ${chunkError.message}`);
  }
  const firstChunkByDocument = new Map((chunkRows ?? []).map((c) => [c.document_id, c.content]));

  return documents.map((doc) => ({
    documentId: doc.id,
    content: firstChunkByDocument.get(doc.id) ?? "",
    title: doc.title,
    client: doc.client,
    documentType: doc.document_type,
    author: doc.author,
    dateCreated: doc.date_created,
    topicCategory: doc.topic_category,
    similarity: null,
  }));
}
