import { NextResponse } from "next/server";
import { getRelevantChunks, browseDocuments } from "@/lib/retrieval";
import { logActivity } from "@/lib/activityLog";

// "Browse by filter" (no query text) has no similarity score to rank by, so
// there's no reason to cap it the way semantic search results are capped —
// the user already narrowed the set with filters and likely wants all of it.
// Also used for the true default view (no query, no filters): the whole
// corpus, since BROWSE_LIMIT (50) comfortably covers this knowledge base's
// size — see the empty-request handling in POST below.
const BROWSE_LIMIT = 50;
const SNIPPET_MAX_LENGTH = 300;

// Threshold/hybrid/substring qualification logic (RELEVANCE_MARGIN,
// ABSOLUTE_FLOOR, the keyword and substring paths) lives in
// lib/retrieval.js's getRelevantChunks() now, shared with /api/ask — see
// that function's comment for the full tuning history and rationale.

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
// Deliberately does NOT re-sort by similarity at the end. getRelevantChunks
// returns chunks pre-ordered by the hybrid ranking rule (semantic-qualifying
// chunks in their existing similarity order, then keyword-only-qualifying
// chunks in ts_rank order, then substring-only-qualifying chunks last), and
// keyword/substring-only chunks have no cosine similarity to sort by at all.
// match_chunks() already returns semantic results in similarity-descending
// order, so for a semantic-only result set this is a no-op; Map preserves
// insertion order, so first-occurrence order (which is the intended rank)
// is what comes out.
function groupByDocument(chunks) {
  const byDocument = new Map();

  for (const chunk of chunks) {
    // keyword/substring-only chunks carry no cosine similarity.
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
        // Untruncated, for the in-document viewer to locate and highlight
        // this exact passage (see /documents/[id]/view) — separate from the
        // truncated `snippet` above, which is only ever for card display.
        matchedChunkId: chunk.chunkId,
        matchedChunkText: chunk.content,
        matchedPageNumber: chunk.pageNumber ?? null,
      });
    } else {
      existing.matchedChunkCount += 1;
      if (similarity != null && (existing.similarity == null || similarity > existing.similarity)) {
        existing.snippet = truncateSnippet(chunk.content);
        existing.similarity = similarity;
        existing.matchedChunkId = chunk.chunkId;
        existing.matchedChunkText = chunk.content;
        existing.matchedPageNumber = chunk.pageNumber ?? null;
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

export async function POST(request) {
  const startedAt = Date.now();
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return errorResponse(`Could not read request body: ${err.message}`, 400);
  }

  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const filters = body?.filters ?? {};

  // No query text means there's nothing to embed or rank by similarity —
  // this is a pure metadata "browse by filter" instead of a semantic search.
  // With zero filters too, this is the tab's default view: browse the whole
  // corpus. Previously this whole case (no query AND no filters) was
  // rejected with a 400 before ever reaching here, which is why the Search
  // tab showed nothing at all until the user typed something or picked a
  // filter — browseDocuments({}, BROWSE_LIMIT) already does exactly the
  // right thing with an empty filters object (no .eq() clauses applied), so
  // there was never a reason to special-case "reject a fully empty request"
  // ahead of it.
  if (!query) {
    let documents;
    try {
      documents = await browseDocuments(filters, BROWSE_LIMIT);
    } catch (err) {
      return errorResponse(`Search failed: ${err.message}`, 500);
    }
    await logActivity({ type: "search", query: query || null, filters, latency_ms: Date.now() - startedAt });
    return NextResponse.json(formatBrowseResults(documents));
  }

  let relevantChunks;
  try {
    relevantChunks = await getRelevantChunks(query, filters);
  } catch (err) {
    return errorResponse(`Search failed: ${err.message}`, 500);
  }

  await logActivity({ type: "search", query, filters, latency_ms: Date.now() - startedAt });
  return NextResponse.json(groupByDocument(relevantChunks));
}
