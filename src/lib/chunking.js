// Character counts approximate tokens (~4 chars/token), so ~2000-3200 chars
// targets the requested ~500-800 tokens per chunk without exact tokenization.
const TARGET_MAX_CHARS = 3200;
const MIN_TRAILING_CHARS = 400;
const OVERLAP_MAX_CHARS = 400;

function splitIntoParagraphs(text) {
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function splitIntoSentences(text) {
  const matches = text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  return matches ? matches.map((s) => s.trim()).filter(Boolean) : [text];
}

// A single paragraph can itself exceed the chunk target (e.g. a dense table
// dump). Break it at sentence boundaries instead of an arbitrary character cut.
function splitOversizedParagraph(paragraph, maxChars) {
  const sentences = splitIntoSentences(paragraph);
  const parts = [];
  let current = "";
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxChars && current) {
      parts.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

// Trailing sentences from the end of a finished chunk, used to seed the next
// chunk so context isn't lost at the boundary.
function trailingOverlap(text, maxChars) {
  const sentences = splitIntoSentences(text);
  let overlap = "";
  for (let i = sentences.length - 1; i >= 0; i--) {
    const candidate = overlap ? `${sentences[i]} ${overlap}` : sentences[i];
    if (candidate.length > maxChars) break;
    overlap = candidate;
  }
  return overlap;
}

// `metadata` is accepted per the caller contract (e.g. upload route passes
// document info) but isn't needed by the splitting logic itself yet.
export function chunkText(text, metadata = {}) {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];

  if (trimmed.length <= TARGET_MAX_CHARS) {
    return [{ content: trimmed, chunkIndex: 0 }];
  }

  const paragraphs = splitIntoParagraphs(trimmed).flatMap((paragraph) =>
    paragraph.length > TARGET_MAX_CHARS
      ? splitOversizedParagraph(paragraph, TARGET_MAX_CHARS)
      : [paragraph]
  );

  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > TARGET_MAX_CHARS && current) {
      chunks.push(current);
      const overlap = trailingOverlap(current, OVERLAP_MAX_CHARS);
      current = overlap ? `${overlap}\n\n${paragraph}` : paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  // Avoid a lone, awkwardly small trailing chunk by folding it into the one
  // before it — but only if the merge wouldn't push the combined chunk over
  // TARGET_MAX_CHARS. A merge that violates the cap defeats the point of the
  // cap in the first place, so an undersized trailing chunk is left as its
  // own chunk instead of being force-merged.
  if (chunks.length > 1 && chunks[chunks.length - 1].length < MIN_TRAILING_CHARS) {
    const tail = chunks[chunks.length - 1];
    const previous = chunks[chunks.length - 2];
    if (previous.length + 2 + tail.length <= TARGET_MAX_CHARS) {
      chunks.pop();
      chunks[chunks.length - 1] = `${previous}\n\n${tail}`;
    }
  }

  return chunks.map((content, chunkIndex) => ({ content, chunkIndex }));
}
