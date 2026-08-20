// Maps chunks back to the PDF page they came from. pdf-parse computes
// per-page text (see parsers.js) but chunking operates on the flattened
// document text, tracking no offsets — so page numbers are recovered after
// the fact by finding each page's (and each chunk's) text within that same
// flat text via indexOf. This is reused both at upload time (new PDFs) and
// by the backfill script (existing PDFs' already-stored chunks).
//
// Matching is whitespace-normalized (all runs of whitespace collapsed to a
// single space) rather than exact — confirmed empirically via the backfill
// that pdf-parse's line-break placement isn't perfectly stable across
// library versions/runs (e.g. "No. 56" vs "No.\n56" for byte-identical
// input), which would otherwise fail an exact match despite being the same
// text. A real content difference (not just whitespace) still won't match,
// which is correct — that page number genuinely can't be trusted.

// Anchor length for locating a chunk's start within the flat text. Full-chunk
// indexOf would also work (chunks are literal substrings of the original
// text), but a shorter anchor is faster and just as unambiguous in practice
// for real prose/document text.
const CHUNK_ANCHOR_CHARS = 200;

function normalize(str) {
  return str.replace(/\s+/g, " ");
}

// Walks pages in order, finding each one's (normalized) text within the
// (normalized) flat text, starting just after the previous page ended.
// Returns null (not a partial array) if any page can't be located — a
// boundary map that's silently missing pages would misattribute later
// chunks to the wrong page, which is worse than having no page numbers at
// all for that document. Callers must reuse the returned normalizedText for
// any offset (e.g. findChunkPageNumber) computed against these boundaries —
// they're only meaningful relative to that exact string.
export function computePageBoundaries(flatText, pages) {
  if (!pages || pages.length === 0) return null;

  const normalizedText = normalize(flatText);
  const boundaries = [];
  let cursor = 0;
  for (const page of pages) {
    const normalizedPageText = normalize(page.text);
    const idx = normalizedText.indexOf(normalizedPageText, cursor);
    if (idx === -1) return null;
    boundaries.push({ num: page.num, start: idx, end: idx + normalizedPageText.length });
    cursor = idx + normalizedPageText.length;
  }
  return { normalizedText, boundaries };
}

// Returns the page number a chunk's content starts on, or null if it
// couldn't be located (boundary map missing, or the chunk's anchor text
// isn't found even whitespace-normalized — a real content difference, not
// just formatting).
export function findChunkPageNumber(chunkContent, pageMap) {
  if (!pageMap) return null;
  const { normalizedText, boundaries } = pageMap;

  const anchor = normalize(chunkContent.slice(0, CHUNK_ANCHOR_CHARS));
  const idx = normalizedText.indexOf(anchor);
  if (idx === -1) return null;

  for (const boundary of boundaries) {
    if (idx >= boundary.start && idx < boundary.end) return boundary.num;
  }
  // Falls in a gap between pages (e.g. a page-break separator) — attribute
  // to the nearest preceding page rather than leaving it unattributed.
  let closest = null;
  for (const boundary of boundaries) {
    if (boundary.start <= idx) closest = boundary.num;
  }
  return closest;
}
