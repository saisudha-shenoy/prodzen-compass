"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import PdfViewer from "@/components/PdfViewer";
import DocxViewer from "@/components/DocxViewer";

function formatFromTitle(title) {
  const match = /\.([^.]+)$/.exec(title || "");
  return match ? match[1].toLowerCase() : "";
}

function CenteredMessage({ children, error }) {
  return (
    <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "40px 20px" }}>
      <div style={{ fontSize: "14.5px", color: error ? "oklch(45% 0.17 25)" : "oklch(48% 0.01 80)" }}>{children}</div>
    </div>
  );
}

function DocumentViewInner() {
  const { id } = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const chunkId = searchParams.get("chunk");

  const [status, setStatus] = useState("loading");
  const [doc, setDoc] = useState(null);
  const [chunk, setChunk] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const docRes = await fetch(`/api/documents/${id}`);
        const docData = await docRes.json();
        if (!docRes.ok) throw new Error(docData.error || `Failed to load document (${docRes.status})`);
        if (!docData.hasFile) throw new Error("The original file for this document isn't available — it was indexed before file storage was added.");

        // Non-fatal if this fails — the viewer just opens without a highlight target.
        let chunkData = null;
        if (chunkId) {
          const chunkRes = await fetch(`/api/chunks/${chunkId}`);
          if (chunkRes.ok) chunkData = await chunkRes.json();
        }

        if (!cancelled) {
          setDoc(docData);
          setChunk(chunkData);
          setStatus("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err.message);
          setStatus("error");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id, chunkId]);

  // In-app highlighting only covers PDF and DOCX (see the scoping writeup —
  // DOCX has no native page/position concept without rendering to HTML, and
  // every other format in the corpus has no highlighting story at all yet).
  // Anything else falls straight back to the pre-existing raw-download flow.
  useEffect(() => {
    if (status !== "ready" || !doc) return;
    const ext = formatFromTitle(doc.title);
    if (ext !== "pdf" && ext !== "docx") {
      window.location.replace(`/api/documents/${id}/download`);
    }
  }, [status, doc, id]);

  if (status === "loading") return <CenteredMessage>Loading document…</CenteredMessage>;
  if (status === "error") return <CenteredMessage error>{errorMessage}</CenteredMessage>;

  const ext = formatFromTitle(doc.title);
  if (ext !== "pdf" && ext !== "docx") return <CenteredMessage>Redirecting to download…</CenteredMessage>;

  return (
    <div style={{ minHeight: "100vh", background: "oklch(97% 0.004 80)" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "oklch(100% 0 0)", borderBottom: "1px solid oklch(90% 0.006 80)", padding: "14px 24px", display: "flex", alignItems: "center", gap: "16px" }}>
        <button
          onClick={() => router.back()}
          style={{ background: "none", border: "1px solid oklch(85% 0.006 80)", borderRadius: "8px", padding: "6px 14px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
        >
          ← Back
        </button>
        <div style={{ fontSize: "14.5px", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.title}</div>
        <a
          href={`/api/documents/${id}/download`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: "auto", fontSize: "12.5px", fontWeight: 600, color: "#272A77", whiteSpace: "nowrap" }}
        >
          Download original
        </a>
      </div>
      <div style={{ padding: "28px 24px 60px" }}>
        {ext === "pdf" && <PdfViewer fileUrl={`/api/documents/${id}/download`} chunkText={chunk?.content} pageNumber={chunk?.pageNumber} title={doc.title} />}
        {ext === "docx" && <DocxViewer documentId={id} chunkText={chunk?.content} />}
      </div>
    </div>
  );
}

export default function DocumentViewPage() {
  return (
    <Suspense fallback={<CenteredMessage>Loading document…</CenteredMessage>}>
      <DocumentViewInner />
    </Suspense>
  );
}
