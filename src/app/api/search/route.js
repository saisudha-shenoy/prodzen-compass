import { NextResponse } from "next/server";
import { retrieveChunks, browseDocuments, keywordSearchChunks } from "@/lib/retrieval";

// Raw chunk-level candidates fetched from match_chunks before any relevance
// filtering. This used to be 8, which was a real bug, not just a tuning
// knob: match_chunks ranks chunks globally, not per-document, so a single
// chunk-heavy document (e.g. a 9-chunk spreadsheet that scores moderately
// against nearly every query) can fill most or all of an 8-slot window and
// crowd out a genuinely relevant document's single best chunk before it's
// ever seen — no similarity threshold downstream can recover a chunk that
// was never fetched. Empirically, "irrigation methods used in cotton
// farming" put the correct 2nd document's best chunk at raw rank 11 (the
// dominant document alone filled ranks 1-10). 20 gives comfortable headroom
// for this corpus's chunkiest documents while staying cheap for a ~20-doc
// knowledge base.
const DEFAULT_MATCH_COUNT = 20;
// "Browse by filter" (no query text) has no similarity score to rank by, so
// there's no reason to cap it the way semantic search results are capped —
// the user already narrowed the set with filters and likely wants all of it.
const BROWSE_LIMIT = 50;
const SNIPPET_MAX_LENGTH = 300;

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

// Hybrid search (additive, Part B of the hybrid-search pass): a second,
// independent qualification path for keyword matches, OR'd with the semantic
// threshold above rather than blended into it — cosine similarity and
// ts_rank aren't on comparable scales, and blending would mean re-deriving
// (and re-calibrating) a combined threshold, undoing the tuning this session
// already did for RELEVANCE_MARGIN/ABSOLUTE_FLOOR. This never removes a
// semantic match; it only adds keyword-only matches the semantic path missed
// (e.g. "Watershed", "Swadesh Darshan", or "esg" vs "ESG" — see SQ.1).
//
// keyword_search_chunks() already gates on `@@` (the term must actually
// appear in the chunk via tsquery matching) before ts_rank is computed at
// all, so ts_rank here is mostly an ordering signal, not a second pass/fail
// gate on top of a real match. MIN_KEYWORD_RANK is set low (0.01) so it only
// screens out the small number of technically-matching-but-negligible edge
// cases (e.g. a single occurrence of a common word buried in a long chunk),
// not real matches on the short, low-noise proper-noun/acronym queries this
// path targets. Starting value only — Part D validates it against real data,
// and it's expected to get tuned further once real usage data exists.
const KEYWORD_MATCH_COUNT = 20;
const MIN_KEYWORD_RANK = 0.01;

function errorResponse(message, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

function truncateSnippet(text, maxLength = SNIPPET_MAX_LENGTH) {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${truncated.slice(0, lastSpace > 0 ? lastSpace : maxLength).trim()}…`;
}

// Chunk-level results -> one card per document, keeping the highest-similarity
// chunk as the representative snippet and counting how many chunks matched.
//
// Deliberately does NOT re-sort by similarity at the end. Callers now pass
// chunks pre-ordered by the hybrid ranking rule (semantic-qualifying chunks
// in their existing similarity order, then keyword-only-qualifying chunks
// appended in ts_rank order — see the route handler below), and keyword-only
// chunks have no cosine similarity to sort by at all. match_chunks() already
// returns semantic results in similarity-descending order, so for a
// semantic-only result set this is a no-op; Map preserves insertion order,
// so first-occurrence order (which is the intended rank) is what comes out.
function groupByDocument(chunks) {
  const byDocument = new Map();

  for (const chunk of chunks) {
    // keyword-only chunks carry a ts_rank, not a cosine similarity.
    const similarity = chunk.similarity ?? null;
    const existing = byDocument.get(chunk.documentId);
    if (!existing) {
      byDocument.set(chunk.documentId, {
        id: chunk.documentId,
        title: chunk.title,
        client: chunk.client,
        document_type: chunk.documentType,
        author: chunk.author,
        date_created: chunk.dateCreated,
        topic_category: chunk.topicCategory,
        snippet: truncateSnippet(chunk.content),
        similarity,
        matchedChunkCount: 1,
      });
    } else {
      existing.matchedChunkCount += 1;
      if (similarity != null && (existing.similarity == null || similarity > existing.similarity)) {
        existing.snippet = truncateSnippet(chunk.content);
        existing.similarity = similarity;
      }
    }
  }

  return Array.from(byDocument.values());
}

// Browse-by-filter results are already one row per document, ordered by
// date_created by the query itself — no similarity score to sort by here.
function formatBrowseResults(documents) {
  return documents.map((doc) => ({
    id: doc.documentId,
    title: doc.title,
    client: doc.client,
    document_type: doc.documentType,
    author: doc.author,
    date_created: doc.dateCreated,
    topic_category: doc.topicCategory,
    snippet: truncateSnippet(doc.content),
    similarity: null,
    matchedChunkCount: 1,
  }));
}

function hasAnyFilter(filters) {
  return Object.values(filters).some((value) => value !== undefined && value !== null && value !== "");
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return errorResponse(`Could not read request body: ${err.message}`, 400);
  }

  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const filters = body?.filters ?? {};

  if (!query && !hasAnyFilter(filters)) {
    return errorResponse('Missing required field: "query" (or at least one filter, to browse without a query)', 400);
  }

  // No query text means there's nothing to embed or rank by similarity —
  // this is a pure metadata "browse by filter" instead of a semantic search.
  if (!query) {
    let documents;
    try {
      documents = await browseDocuments(filters, BROWSE_LIMIT);
    } catch (err) {
      return errorResponse(`Search failed: ${err.message}`, 500);
    }
    return NextResponse.json(formatBrowseResults(documents));
  }

  let chunks;
  try {
    chunks = await retrieveChunks(query, filters, DEFAULT_MATCH_COUNT);
  } catch (err) {
    return errorResponse(`Search failed: ${err.message}`, 500);
  }

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
  // above (see the hybrid-search comment near MIN_KEYWORD_RANK). Failure
  // here degrades to semantic-only results rather than failing the request —
  // this path is a supplement, not a dependency.
  let keywordQualified = [];
  try {
    const keywordChunks = await keywordSearchChunks(query, filters, KEYWORD_MATCH_COUNT);
    keywordQualified = keywordChunks.filter((chunk) => chunk.rank > MIN_KEYWORD_RANK);
  } catch (err) {
    console.error(`Keyword search failed, continuing with semantic-only results: ${err.message}`);
  }

  const semanticIds = new Set(semanticQualified.map((chunk) => chunk.chunkId));
  const keywordOnly = keywordQualified
    .filter((chunk) => !semanticIds.has(chunk.chunkId))
    .sort((a, b) => b.rank - a.rank);

  // Ranking rule (starting point, not final — re-ranking is a later, separate
  // phase): semantic-qualifying chunks keep their existing similarity-based
  // order; keyword-only-qualifying chunks are appended after them, ordered
  // by ts_rank.
  const relevantChunks = [...semanticQualified, ...keywordOnly];

  return NextResponse.json(groupByDocument(relevantChunks));
}
