"use client";

import { useEffect, useRef, useState } from "react";
import SearchTab from "@/components/SearchTab";
import AskTab from "@/components/AskTab";
import UploadTab from "@/components/UploadTab";
import { ACCEPTED_EXT, MAX_UPLOAD_SIZE } from "@/lib/constants";
import { getFriendlyErrorMessage } from "@/lib/friendlyErrors";

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function extOf(name) {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// /api/upload's field names differ from this app's internal meta keys.
function buildUploadFormData(rawFile, meta, duplicateAction) {
  const formData = new FormData();
  formData.append("file", rawFile);
  formData.append("client", meta.client);
  formData.append("documentType", meta.type);
  formData.append("author", meta.author);
  formData.append("dateCreated", meta.date);
  formData.append("topicCategory", meta.industry);
  if (duplicateAction) formData.append("duplicateAction", duplicateAction);
  return formData;
}

function tabBtnStyle(active) {
  return {
    padding: "8px 18px",
    borderRadius: "7px",
    border: "none",
    fontSize: "13.5px",
    fontWeight: 700,
    cursor: "pointer",
    background: active ? "oklch(100% 0 0)" : "transparent",
    color: active ? "oklch(30% 0.01 80)" : "oklch(48% 0.01 80)",
    boxShadow: active ? "0 1px 3px oklch(0% 0 0 / 0.08)" : "none",
  };
}

export default function Page() {
  const [activeTab, setActiveTab] = useState("search");
  // The real, shared source of truth for "what documents currently exist" —
  // read by Ask's readiness gate + citation availability, and by Search's
  // delete flow. Fetched on load and refreshed after any successful
  // upload/delete so every tab stays in sync without a page refresh.
  const [documents, setDocuments] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [clientFilter, setClientFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [authorFilter, setAuthorFilter] = useState("All");
  const [industryFilter, setIndustryFilter] = useState("All");
  const [formatFilter, setFormatFilter] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [lastQuestion, setLastQuestion] = useState("");

  const [uploadFiles, setUploadFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);

  const idCounter = useRef(1);
  const nextId = (prefix) => prefix + idCounter.current++;

  // Mirror of uploadFiles read from inside setTimeout callbacks, so those
  // callbacks always see the freshest value instead of the render they were
  // created in.
  const uploadFilesRef = useRef(uploadFiles);
  uploadFilesRef.current = uploadFiles;

  const goSearch = () => setActiveTab("search");
  const goAsk = () => setActiveTab("ask");
  const goUpload = () => setActiveTab("upload");

  async function fetchDocuments() {
    try {
      const res = await fetch("/api/documents");
      const data = await res.json();
      if (res.ok && Array.isArray(data)) setDocuments(data);
    } catch {
      // Best-effort refresh — a transient failure here just means Ask's gate
      // and citation availability stay on the last-known list until the next
      // successful refresh (upload/delete/reload), not a fatal app error.
    }
  }

  useEffect(() => {
    fetchDocuments();
  }, []);

  async function deleteDocument(id) {
    const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Failed to delete document (status ${res.status}).`);
    }
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  }

  const clearFilters = () => {
    setSearchQuery("");
    setClientFilter("All");
    setTypeFilter("All");
    setAuthorFilter("All");
    setIndustryFilter("All");
    setFormatFilter("All");
    setDateFrom("");
    setDateTo("");
  };

  // --- Upload tab: file intake ---
  function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploadFiles((prev) => {
      // Same filename + same byte size is treated as "the same file" already in
      // the queue (either from a prior drop, or an earlier file in this same
      // batch) — quietly skip it instead of adding a second card for it.
      const seen = new Set(prev.map((f) => `${f.name}::${f.size}`));
      const newEntries = [];
      for (const file of files) {
        const key = `${file.name}::${file.size}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const ext = extOf(file.name);
        const id = nextId("f");
        if (!ACCEPTED_EXT.includes(ext)) {
          newEntries.push({
            id,
            name: file.name,
            size: file.size,
            sizeLabel: formatBytes(file.size),
            status: "invalid",
            error: `Unsupported file format ".${ext || "unknown"}". Accepted: PDF, DOCX, PPTX, XLSX, CSV, TXT, and images (JPG, PNG).`,
          });
          continue;
        }
        if (file.size > MAX_UPLOAD_SIZE) {
          newEntries.push({
            id,
            name: file.name,
            size: file.size,
            sizeLabel: formatBytes(file.size),
            status: "invalid",
            error: `File exceeds the 25 MB limit (${formatBytes(file.size)}).`,
          });
          continue;
        }
        // Duplicate detection now happens server-side (by content hash, once the
        // file + metadata are actually submitted) — every valid file starts at
        // the metadata form; /api/upload's response tells us if it's a duplicate.
        newEntries.push({
          id,
          name: file.name,
          size: file.size,
          sizeLabel: formatBytes(file.size),
          format: ext.toUpperCase(),
          status: "metadata",
          file,
          meta: { client: "", type: "", author: "", industry: "", date: "" },
        });
      }
      return [...newEntries, ...prev];
    });
  }

  const handleFilesInput = (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  };
  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    addFiles(e.dataTransfer.files);
  };
  const handleDragOver = (e) => {
    e.preventDefault();
    setDragActive(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragActive(false);
  };

  const dismissFile = (id) => setUploadFiles((prev) => prev.filter((f) => f.id !== id));

  const updateMeta = (id, field, value) =>
    setUploadFiles((prev) => prev.map((f) => (f.id === id ? { ...f, meta: { ...f.meta, [field]: value } } : f)));

  // Cosmetic timing for the Parsing/Indexing stages — the real request runs
  // concurrently. The final state (Complete/Failed/duplicate) always reflects
  // the actual /api/upload response, never the timer: if the response arrives
  // first, staging still plays out fully before the real result is shown; if
  // the request is slower, the file just holds at "Indexing" until it resolves.
  const SIMULATED_PARSING_MS = 900;
  const SIMULATED_INDEXING_MS = 1300;

  async function runUpload(id, duplicateAction) {
    const file = uploadFiles.find((f) => f.id === id);
    if (!file) return;

    setUploadFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "parsing", error: undefined } : f)));

    const stagingDone = (async () => {
      await sleep(SIMULATED_PARSING_MS);
      setUploadFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "indexing" } : f)));
      await sleep(SIMULATED_INDEXING_MS);
    })();

    const formData = buildUploadFormData(file.file, file.meta, duplicateAction);
    const fetchDone = fetch("/api/upload", { method: "POST", body: formData })
      .then(async (res) => {
        let data = {};
        try {
          data = await res.json();
        } catch {
          // fall through with an empty body — handled by the shape checks below
        }
        return { ok: res.ok, status: res.status, data };
      })
      .catch((err) => ({ ok: false, status: 0, data: { error: `Network error: ${err.message}` } }));

    const [, result] = await Promise.all([stagingDone, fetchDone]);

    // The file may have been removed from the queue while this was in flight
    // (shouldn't normally happen mid-upload, but don't resurrect it if so).
    if (!uploadFilesRef.current.some((f) => f.id === id)) return;

    if (!result.ok) {
      const rawMessage = result.data?.error || `Upload failed (status ${result.status}).`;
      const errorKind = result.data?.kind;
      const friendlyMessage = getFriendlyErrorMessage({ message: rawMessage, kind: errorKind });
      setUploadFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: "failed", error: friendlyMessage, errorKind } : f))
      );
      return;
    }

    if (result.data?.isDuplicate) {
      setUploadFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: "duplicate", existingDocument: result.data.existingDocument } : f))
      );
      return;
    }

    setUploadFiles((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, status: "complete", documentId: result.data.documentId, chunkCount: result.data.chunkCount } : f
      )
    );
    fetchDocuments();
  }

  function resolveDuplicate(id, action) {
    if (action === "skip") {
      dismissFile(id);
      return;
    }
    // "replace": resubmit the exact same file + metadata already on this
    // entry, just with duplicateAction: "replace" added — no re-entering
    // metadata, straight back into the normal parsing/indexing pipeline.
    runUpload(id, "replace");
  }

  function submitMetadata(id) {
    runUpload(id);
  }

  // --- Ask tab: chat ---
  async function sendChat(retryText) {
    const isRetry = retryText !== undefined;
    const q = (isRetry ? retryText : chatInput).trim();
    if (!q || isThinking) return;
    setChatMessages((prev) =>
      isRetry ? prev.filter((m) => m.role !== "error") : [...prev, { id: nextId("m"), role: "user", text: q }]
    );
    if (!isRetry) setChatInput("");
    setIsThinking(true);
    setLastQuestion(q);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();
      if (!res.ok || typeof data?.answer !== "string" || !Array.isArray(data?.citations)) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      setChatMessages((prev) => [
        ...prev,
        { id: nextId("m"), role: "assistant", text: data.answer, citations: data.citations, hasCitations: Boolean(data.hasCitations) },
      ]);
    } catch (err) {
      const friendlyMessage = getFriendlyErrorMessage({ message: err?.message });
      setChatMessages((prev) => [...prev, { id: nextId("m"), role: "error", text: friendlyMessage }]);
    } finally {
      setIsThinking(false);
    }
  }

  const retryLastQuestion = () => sendChat(lastQuestion);

  return (
    <div style={{ minHeight: "100vh", background: "oklch(98.3% 0.004 80)", color: "oklch(20% 0.01 80)", display: "flex", flexDirection: "column" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: "oklch(100% 0 0)", borderBottom: "1px solid oklch(90% 0.006 80)" }}>
        <div style={{ maxWidth: "1240px", margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 32px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div style={{ fontWeight: 800, fontSize: "13px", letterSpacing: "0.06em", fontVariant: "small-caps", color: "#272A77" }}>PRODZEN</div>
            <div style={{ fontWeight: 800, fontSize: "21px", letterSpacing: "-0.02em" }}>
              ProdZen <span style={{ color: "#272A77" }}>Compass</span>
            </div>
            <div style={{ width: "1px", height: "20px", background: "oklch(90% 0.006 80)" }}></div>
            <div style={{ fontSize: "12.5px", color: "oklch(48% 0.01 80)" }}>Turning Ideas Into Growing Businesses</div>
            <div
              style={{
                fontSize: "10.5px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "oklch(48% 0.01 80)",
                background: "oklch(94% 0.006 80)",
                padding: "3px 8px",
                borderRadius: "5px",
              }}
            >
              Internal · Beta
            </div>
          </div>
          <nav style={{ display: "flex", gap: "4px", background: "oklch(95% 0.006 80)", padding: "4px", borderRadius: "10px" }}>
            <button style={tabBtnStyle(activeTab === "search")} onClick={goSearch}>
              Search
            </button>
            <button style={tabBtnStyle(activeTab === "ask")} onClick={goAsk}>
              Ask
            </button>
            <button style={tabBtnStyle(activeTab === "upload")} onClick={goUpload}>
              Upload
            </button>
          </nav>
        </div>
      </div>

      <div style={{ maxWidth: "1240px", width: "100%", margin: "0 auto", padding: "32px", flex: 1, display: "flex", flexDirection: "column" }}>
        {activeTab === "search" && (
          <SearchTab
            documents={documents}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            clientFilter={clientFilter}
            setClientFilter={setClientFilter}
            typeFilter={typeFilter}
            setTypeFilter={setTypeFilter}
            authorFilter={authorFilter}
            setAuthorFilter={setAuthorFilter}
            industryFilter={industryFilter}
            setIndustryFilter={setIndustryFilter}
            formatFilter={formatFilter}
            setFormatFilter={setFormatFilter}
            dateFrom={dateFrom}
            setDateFrom={setDateFrom}
            dateTo={dateTo}
            setDateTo={setDateTo}
            clearFilters={clearFilters}
            onDeleteDocument={deleteDocument}
          />
        )}

        {activeTab === "ask" && (
          <AskTab
            documents={documents}
            chatMessages={chatMessages}
            chatInput={chatInput}
            setChatInput={setChatInput}
            isThinking={isThinking}
            sendChat={sendChat}
            onRetry={retryLastQuestion}
            goUpload={goUpload}
          />
        )}

        {activeTab === "upload" && (
          <UploadTab
            uploadFiles={uploadFiles}
            dragActive={dragActive}
            handleDrop={handleDrop}
            handleDragOver={handleDragOver}
            handleDragLeave={handleDragLeave}
            handleFilesInput={handleFilesInput}
            dismissFile={dismissFile}
            updateMeta={updateMeta}
            submitMetadata={submitMetadata}
            resolveDuplicate={resolveDuplicate}
          />
        )}
      </div>
    </div>
  );
}
