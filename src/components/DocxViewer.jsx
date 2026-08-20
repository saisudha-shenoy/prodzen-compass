"use client";

import { useEffect, useRef, useState } from "react";

const ANCHOR_CHARS = 150;
const HIGHLIGHT_STYLE = "background: oklch(85% 0.14 95 / 0.55); border-radius: 2px;";

function normalize(str) {
  return str.replace(/\s+/g, " ").trim();
}

// Walks every text node under root, building a normalized (whitespace-
// collapsed) version of its full text alongside a parallel array mapping
// each normalized character back to the exact (node, offset) it came from.
// Not trimmed — trimming would desync the two arrays' indices.
function buildNormalizedIndex(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const positions = [];
  let normalizedText = "";
  let lastWasSpace = true;
  let node = walker.nextNode();
  while (node) {
    const raw = node.nodeValue;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (/\s/.test(ch)) {
        if (!lastWasSpace) {
          normalizedText += " ";
          positions.push({ node, offset: i });
          lastWasSpace = true;
        }
      } else {
        normalizedText += ch;
        positions.push({ node, offset: i });
        lastWasSpace = false;
      }
    }
    node = walker.nextNode();
  }
  return { normalizedText, positions };
}

// Wraps the matched character range in <mark> elements, one per distinct
// text node it touches — robust to the match spanning multiple DOM
// elements (bold runs, paragraph breaks rendered as separate nodes, etc.),
// which Range.surroundContents() can't handle directly.
function highlightRange(positions, startIdx, endIdx) {
  const touched = [];
  let i = startIdx;
  while (i <= endIdx) {
    const { node } = positions[i];
    let j = i;
    while (j <= endIdx && positions[j].node === node) j++;
    touched.push({ node, startOffset: positions[i].offset, endOffset: positions[j - 1].offset + 1 });
    i = j;
  }

  const marks = [];
  touched.forEach(({ node, startOffset, endOffset }) => {
    const middle = node.splitText(startOffset);
    middle.splitText(endOffset - startOffset);
    const mark = document.createElement("mark");
    mark.setAttribute("style", HIGHLIGHT_STYLE);
    middle.parentNode.insertBefore(mark, middle);
    mark.appendChild(middle);
    marks.push(mark);
  });
  return marks;
}

export default function DocxViewer({ documentId, chunkText }) {
  const containerRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [html, setHtml] = useState("");
  const [matched, setMatched] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/documents/${documentId}/render`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Failed to render document (${res.status})`);
        return data;
      })
      .then((data) => {
        if (!cancelled) {
          setHtml(data.html);
          setStatus("ready");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMessage(err.message);
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  useEffect(() => {
    if (status !== "ready" || !containerRef.current || !chunkText) return;

    const anchor = normalize(chunkText).slice(0, ANCHOR_CHARS);
    const { normalizedText, positions } = buildNormalizedIndex(containerRef.current);
    const idx = normalizedText.indexOf(anchor);
    if (idx === -1) return;

    const marks = highlightRange(positions, idx, idx + anchor.length - 1);
    setMatched(true);
    marks[0]?.scrollIntoView({ behavior: "smooth", block: "center" });
    // Deliberately no cleanup: this runs once per successful render() of a
    // freshly-fetched HTML string, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, html, chunkText]);

  if (status === "loading") {
    return <div style={{ padding: "60px 20px", textAlign: "center", color: "oklch(48% 0.01 80)" }}>Loading document…</div>;
  }
  if (status === "error") {
    return <div style={{ padding: "60px 20px", textAlign: "center", color: "oklch(45% 0.17 25)" }}>Couldn&apos;t load this document: {errorMessage}</div>;
  }

  return (
    <div style={{ maxWidth: "760px", margin: "0 auto" }}>
      {chunkText && (
        <div style={{ fontSize: "13px", color: matched ? "#272A77" : "oklch(55% 0.01 80)", fontWeight: 600, marginBottom: "14px" }}>
          {matched ? "Matched passage highlighted below" : "Couldn't locate the exact matched passage in the rendered document — showing the full document instead"}
        </div>
      )}
      <div
        ref={containerRef}
        style={{ background: "oklch(100% 0 0)", border: "1px solid oklch(92% 0.006 80)", borderRadius: "12px", padding: "32px 40px", fontSize: "14.5px", lineHeight: 1.7, color: "oklch(20% 0.01 80)" }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
