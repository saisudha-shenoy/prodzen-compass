"use client";

import { useEffect, useRef, useState } from "react";

// workerSrc points at the static copy in /public (copied from
// node_modules/pdfjs-dist/build/pdf.worker.min.mjs) rather than letting
// pdfjs-dist resolve its own worker via a dynamic import — Turbopack has
// already been observed mangling that exact pattern for pdf-parse's
// (server-side) worker in lib/parsers.js; a plain static URL loaded via the
// browser's real Worker constructor sidesteps the same class of problem
// here on the client.
let pdfjsLibPromise;
function loadPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("pdfjs-dist").then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return mod;
    });
  }
  return pdfjsLibPromise;
}

const RENDER_SCALE = 1.4;
const ANCHOR_CHARS = 120;
const HIGHLIGHT_STYLE = { background: "oklch(85% 0.14 95 / 0.55)", borderRadius: "2px" };

function normalize(str) {
  return str.replace(/\s+/g, " ").trim();
}

// Reconstructs page text the same way for both the search anchor and the
// page itself: items joined with a single space, whitespace collapsed. This
// won't always match pdf-parse's own extraction (used to build chunkText at
// ingest time) character-for-character — that's an accepted limitation, not
// a bug: real-world PDFs vary enough in internal spacing/ligatures that a
// pixel-precise guarantee isn't achievable without also storing exact
// character offsets, which the corpus doesn't have (see the migration for
// why: page-level, not character-level, granularity was the scoped target).
async function getPageMatch(pdfDoc, pageNum, anchor) {
  const page = await pdfDoc.getPage(pageNum);
  const textContent = await page.getTextContent();

  // Builds fullText and itemOffsets together in one pass, rather than
  // building the whole string first and normalizing whitespace after —
  // normalizing after the fact changes fullText's length, desyncing it from
  // itemOffsets (recorded against the pre-normalization string) and
  // misattributing the match to the wrong items. The separator check avoids
  // introducing a double space at an item boundary where the previous
  // item already ended (or this one already starts) with whitespace.
  let fullText = "";
  const itemOffsets = [];
  textContent.items.forEach((item) => {
    const itemText = normalize(item.str);
    if (!itemText) {
      itemOffsets.push({ start: fullText.length, end: fullText.length });
      return;
    }
    if (fullText.length > 0 && !/\s$/.test(fullText) && !/^\s/.test(itemText)) {
      fullText += " ";
    }
    const start = fullText.length;
    fullText += itemText;
    itemOffsets.push({ start, end: fullText.length });
  });

  if (!anchor) return { page, textContent, matchRange: null };

  const idx = fullText.indexOf(anchor);
  if (idx === -1) return { page, textContent, matchRange: null };

  const matchStart = idx;
  const matchEnd = idx + anchor.length;
  const matchedItemIndexes = itemOffsets
    .map((o, i) => ({ ...o, i }))
    .filter((o) => o.end > matchStart && o.start < matchEnd)
    .map((o) => o.i);

  return { page, textContent, matchRange: matchedItemIndexes };
}

export default function PdfViewer({ fileUrl, chunkText, pageNumber, title }) {
  const canvasRef = useRef(null);
  const textLayerContainerRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [pageState, setPageState] = useState({ current: 1, total: 0, matched: false });
  const pdfDocRef = useRef(null);
  const requestedPageRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const pdfjsLib = await loadPdfjs();
        const loadingTask = pdfjsLib.getDocument(fileUrl);
        const pdfDoc = await loadingTask.promise;
        if (cancelled) return;
        pdfDocRef.current = pdfDoc;

        const anchor = chunkText ? normalize(chunkText).slice(0, ANCHOR_CHARS) : null;
        const startPage = pageNumber && pageNumber >= 1 && pageNumber <= pdfDoc.numPages ? pageNumber : 1;

        let match = await getPageMatch(pdfDoc, startPage, anchor);
        let landedPage = startPage;
        if (!match.matchRange && anchor) {
          for (let p = 1; p <= pdfDoc.numPages; p++) {
            if (p === startPage) continue;
            const attempt = await getPageMatch(pdfDoc, p, anchor);
            if (attempt.matchRange) {
              match = attempt;
              landedPage = p;
              break;
            }
          }
        }
        if (cancelled) return;

        requestedPageRef.current = { pageNum: landedPage, matchRange: match.matchRange };
        setPageState({ current: landedPage, total: pdfDoc.numPages, matched: Boolean(match.matchRange) });
        setStatus("ready");
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err.message || "Failed to load PDF.");
          setStatus("error");
        }
      }
    }

    init();
    return () => {
      cancelled = true;
      pdfDocRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl]);

  // Renders whichever page is current, highlighting the match only on the
  // page it was actually found on (matchRange is null for every other page
  // the user navigates to).
  useEffect(() => {
    if (status !== "ready" || !pdfDocRef.current) return;
    let cancelled = false;

    async function renderPage() {
      const pdfDoc = pdfDocRef.current;
      const pageNum = pageState.current;
      const matchRange = requestedPageRef.current?.pageNum === pageNum ? requestedPageRef.current.matchRange : null;

      const page = await pdfDoc.getPage(pageNum);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: RENDER_SCALE });

      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      if (cancelled) return;

      const textLayerContainer = textLayerContainerRef.current;
      textLayerContainer.innerHTML = "";

      const pdfjsLib = await loadPdfjs();
      const textContent = await page.getTextContent();
      const textLayer = new pdfjsLib.TextLayer({ textContentSource: textContent, container: textLayerContainer, viewport });
      await textLayer.render();
      if (cancelled) return;

      if (matchRange && matchRange.length) {
        matchRange.forEach((i) => {
          const div = textLayer.textDivs[i];
          if (div) Object.assign(div.style, HIGHLIGHT_STYLE);
        });
        textLayer.textDivs[matchRange[0]]?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }

    renderPage();
    return () => {
      cancelled = true;
    };
  }, [status, pageState.current]);

  const goToPage = (delta) => {
    setPageState((prev) => {
      const next = Math.min(Math.max(prev.current + delta, 1), prev.total);
      return { ...prev, current: next, matched: requestedPageRef.current?.pageNum === next && Boolean(requestedPageRef.current?.matchRange) };
    });
  };

  if (status === "loading") {
    return <div style={{ padding: "60px 20px", textAlign: "center", color: "oklch(48% 0.01 80)" }}>Loading document…</div>;
  }
  if (status === "error") {
    return <div style={{ padding: "60px 20px", textAlign: "center", color: "oklch(45% 0.17 25)" }}>Couldn&apos;t load this PDF: {errorMessage}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "13px", color: "oklch(45% 0.01 80)" }}>
        <button
          onClick={() => goToPage(-1)}
          disabled={pageState.current <= 1}
          style={{ padding: "5px 12px", borderRadius: "6px", border: "1px solid oklch(85% 0.006 80)", background: "oklch(100% 0 0)", cursor: pageState.current <= 1 ? "default" : "pointer" }}
        >
          ← Prev
        </button>
        <span>
          Page {pageState.current} of {pageState.total}
          {requestedPageRef.current?.pageNum === pageState.current && requestedPageRef.current?.matchRange && (
            <span style={{ marginLeft: "8px", color: "#272A77", fontWeight: 600 }}>— matched passage highlighted</span>
          )}
        </span>
        <button
          onClick={() => goToPage(1)}
          disabled={pageState.current >= pageState.total}
          style={{ padding: "5px 12px", borderRadius: "6px", border: "1px solid oklch(85% 0.006 80)", background: "oklch(100% 0 0)", cursor: pageState.current >= pageState.total ? "default" : "pointer" }}
        >
          Next →
        </button>
      </div>
      <div style={{ position: "relative", boxShadow: "0 1px 8px oklch(0% 0 0 / 0.12)" }}>
        <canvas ref={canvasRef} style={{ display: "block" }} />
        <div ref={textLayerContainerRef} className="pdfTextLayer" style={{ position: "absolute", top: 0, left: 0 }} />
      </div>
      <style jsx global>{`
        .pdfTextLayer {
          /* pdf.js's own TextLayer.render() sizes this container via an
             internal "round(down, var(--total-scale-factor) * <page width in
             CSS px>, var(--scale-round-x))" style rule (see setLayerDimensions
             in pdfjs-dist's source) — it expects the *consumer* to define
             these custom properties (normally shipped in pdf.js's own
             web/pdf_viewer.css, which the npm package doesn't include).
             Left undefined, the rule is invalid and the container collapses
             to 0 width, silently clipping every text-layer span (including
             the highlighted one) to invisible via overflow: hidden below —
             the actual root cause diagnosed via a real render (see
             verification). Kept equal to RENDER_SCALE above by hand — this
             file has no build step to compute it automatically. */
          --total-scale-factor: 1.4;
          --scale-round-x: 1px;
          --scale-round-y: 1px;
          overflow: hidden;
          line-height: 1;
          text-size-adjust: none;
          transform-origin: 0 0;
        }
        .pdfTextLayer span,
        .pdfTextLayer br {
          color: transparent;
          position: absolute;
          white-space: pre;
          cursor: text;
          transform-origin: 0% 0%;
        }
      `}</style>
    </div>
  );
}
