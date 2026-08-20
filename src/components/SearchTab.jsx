import { useEffect, useRef, useState } from "react";
import { DOC_TYPES, INDUSTRIES } from "@/lib/constants";
import { getFriendlyErrorMessage } from "@/lib/friendlyErrors";

function uniqOptions(values) {
  return ["All", ...Array.from(new Set(values.filter(Boolean))).sort()];
}

function formatFromTitle(title) {
  const match = /\.([^.]+)$/.exec(title || "");
  return match ? match[1].toUpperCase() : "";
}

const filterLabelStyle = {
  fontSize: "10.5px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  color: "oklch(55% 0.01 80)",
};

function FilterField({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <span style={filterLabelStyle}>{label}</span>
      {children}
    </div>
  );
}

// Optional metadata fields (Client, Author) render as a filled badge when
// present. When blank, "<Label> not specified" in italic + the same muted
// color already used elsewhere for "this isn't real data" (e.g. the
// disabled "Open document" state below) reads as "field intentionally
// empty" rather than looking like missing/broken data. The badge row has no
// column headers, so the label is included in the empty-state text itself —
// otherwise a bare "Not specified" doesn't say which field it refers to.
function MetaBadge({ value, label, background, color }) {
  if (value) {
    return (
      <span style={{ fontSize: "11.5px", fontWeight: 600, padding: "4px 10px", borderRadius: "999px", background, color }}>{value}</span>
    );
  }
  return (
    <span
      style={{
        fontSize: "11.5px",
        fontWeight: 500,
        fontStyle: "italic",
        padding: "4px 10px",
        borderRadius: "999px",
        background: "oklch(96% 0.004 80)",
        color: "oklch(70% 0.006 80)",
      }}
    >
      {label} not specified
    </span>
  );
}

export default function SearchTab({
  documents,
  searchQuery,
  setSearchQuery,
  clientFilter,
  setClientFilter,
  typeFilter,
  setTypeFilter,
  authorFilter,
  setAuthorFilter,
  industryFilter,
  setIndustryFilter,
  formatFilter,
  setFormatFilter,
  dateFrom,
  setDateFrom,
  dateTo,
  setDateTo,
  clearFilters,
  onDeleteDocument,
}) {
  const [results, setResults] = useState(null); // null = no search performed yet
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);

  const abortRef = useRef(null);

  // No query text is valid as long as at least one filter is set — that's a
  // "browse by filter" request rather than a semantic search.
  const filtersActive = Boolean(
    clientFilter !== "All" ||
      typeFilter !== "All" ||
      authorFilter !== "All" ||
      industryFilter !== "All" ||
      dateFrom ||
      dateTo
  );

  async function runSearch(query) {
    const trimmed = query.trim();
    if (!trimmed && !filtersActive) {
      abortRef.current?.abort();
      setLoading(false);
      setError(null);
      setResults(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          query: trimmed,
          filters: {
            client: clientFilter !== "All" ? clientFilter : undefined,
            documentType: typeFilter !== "All" ? typeFilter : undefined,
            author: authorFilter !== "All" ? authorFilter : undefined,
            topicCategory: industryFilter !== "All" ? industryFilter : undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Search failed (${res.status})`);
      setResults(data);
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(getFriendlyErrorMessage({ message: err.message, kind: err.kind }));
      setResults(null);
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }

  // Run once on mount so arriving here with a query already set (e.g. jumping
  // in from an Ask citation, or returning to this tab) searches immediately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (searchQuery.trim() || filtersActive) runSearch(searchQuery);
  }, []);

  // Filter changes re-run the current query — or, with no query text, run a
  // browse-by-filter — as long as there's a query or a filter to act on.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (searchQuery.trim() || filtersActive) {
      runSearch(searchQuery);
    } else {
      setResults(null);
      setError(null);
    }
  }, [clientFilter, typeFilter, authorFilter, industryFilter, dateFrom, dateTo]);

  // Clearing the query text (typing it out, or "Clear filters") drops back to
  // a pure browse-by-filter if filters are still active, or clears results
  // entirely if nothing is set anymore.
  useEffect(() => {
    if (!searchQuery.trim()) {
      if (filtersActive) runSearch("");
      else {
        setResults(null);
        setError(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const handleSearchKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch(searchQuery);
    }
  };

  const onDeleteClick = (id) => {
    setDeleteError(null);
    setConfirmDeleteId(id);
  };
  const onCancelDelete = () => {
    setDeleteError(null);
    setConfirmDeleteId(null);
  };
  const onConfirmDelete = async (id) => {
    try {
      await onDeleteDocument(id);
      setConfirmDeleteId((cur) => (cur === id ? null : cur));
      // Re-run the active search so the deleted card actually disappears from
      // results too, not just from future citation-availability checks.
      if (searchQuery.trim() || filtersActive) runSearch(searchQuery);
      else setResults((prev) => (prev ? prev.filter((d) => d.id !== id) : prev));
    } catch (err) {
      setDeleteError(err.message);
    }
  };

  // Sourced from the full corpus (GET /api/documents), not from the last
  // search response — otherwise these are empty/incomplete until a search
  // has run, and never include documents the current results don't cover.
  const clientOptions = uniqOptions(documents.map((d) => d.client));
  const authorOptions = uniqOptions(documents.map((d) => d.author));
  const typeOptions = ["All", ...DOC_TYPES];
  const industryOptions = ["All", ...INDUSTRIES];
  const formatOptions = uniqOptions(documents.map((d) => formatFromTitle(d.title)));

  const anyFilterActive = Boolean(
    searchQuery.trim() ||
      clientFilter !== "All" ||
      typeFilter !== "All" ||
      authorFilter !== "All" ||
      industryFilter !== "All" ||
      formatFilter !== "All" ||
      dateFrom ||
      dateTo
  );

  const visibleResults = (results || []).filter((d) => formatFilter === "All" || formatFromTitle(d.title) === formatFilter);

  // Search results don't carry storage_path themselves (per the retrieval
  // pipeline) — cross-reference the full corpus (GET /api/documents, already
  // fetched for filter options) to know whether each result has a stored file.
  const storagePathById = new Map(documents.map((d) => [d.id, d.storage_path]));

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "24px" }}>
        <div style={{ position: "relative" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="e.g. European market entry strategy"
            style={{ width: "100%", padding: "16px 44px 16px 20px", fontSize: "16px", border: "1px solid oklch(88% 0.006 80)", borderRadius: "12px", background: "oklch(100% 0 0)", outline: "none" }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              title="Clear search"
              style={{
                position: "absolute",
                right: "14px",
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                color: "oklch(55% 0.01 80)",
                fontSize: "20px",
                lineHeight: 1,
                cursor: "pointer",
                padding: "4px",
              }}
            >
              ×
            </button>
          )}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", alignItems: "flex-end", padding: "14px 16px", background: "oklch(100% 0 0)", border: "1px solid oklch(92% 0.006 80)", borderRadius: "12px" }}>
          <span style={{ fontSize: "12px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "oklch(48% 0.01 80)", alignSelf: "center" }}>Filters</span>
          <FilterField label="Client">
            <select
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid oklch(88% 0.006 80)", fontSize: "13px", background: "oklch(98% 0.004 80)" }}
            >
              {clientOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Document Type">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid oklch(88% 0.006 80)", fontSize: "13px", background: "oklch(98% 0.004 80)" }}
            >
              {typeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Author">
            <select
              value={authorFilter}
              onChange={(e) => setAuthorFilter(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid oklch(88% 0.006 80)", fontSize: "13px", background: "oklch(98% 0.004 80)" }}
            >
              {authorOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Topic / Product Category">
            <select
              value={industryFilter}
              onChange={(e) => setIndustryFilter(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid oklch(88% 0.006 80)", fontSize: "13px", background: "oklch(98% 0.004 80)" }}
            >
              {industryOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Format">
            <select
              value={formatFilter}
              onChange={(e) => setFormatFilter(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid oklch(88% 0.006 80)", fontSize: "13px", background: "oklch(98% 0.004 80)" }}
            >
              {formatOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Created Date">
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                style={{ padding: "7px 10px", borderRadius: "8px", border: "1px solid oklch(88% 0.006 80)", fontSize: "13px", background: "oklch(98% 0.004 80)" }}
              />
              <span style={{ color: "oklch(60% 0.01 80)", fontSize: "12px" }}>to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                style={{ padding: "7px 10px", borderRadius: "8px", border: "1px solid oklch(88% 0.006 80)", fontSize: "13px", background: "oklch(98% 0.004 80)" }}
              />
            </div>
          </FilterField>
          {anyFilterActive && (
            <button onClick={clearFilters} style={{ marginLeft: "auto", background: "none", border: "none", color: "#272A77", fontSize: "13px", fontWeight: 600, cursor: "pointer", padding: "6px 4px" }}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "oklch(48% 0.01 80)" }}>
          <span style={{ animation: "pulse 1.2s infinite" }}>●</span> <span style={{ animation: "pulse 1.2s infinite 0.2s" }}>●</span>{" "}
          <span style={{ animation: "pulse 1.2s infinite 0.4s" }}>●</span>
        </div>
      )}

      {error && (
        <div style={{ background: "oklch(98% 0.015 25)", border: "1px solid oklch(85% 0.03 25)", borderRadius: "12px", padding: "16px 20px", marginBottom: "14px" }}>
          <div style={{ fontSize: "14px", color: "oklch(45% 0.17 25)", marginBottom: "10px" }}>{error}</div>
          <button
            onClick={() => runSearch(searchQuery)}
            style={{ background: "none", border: "1px solid oklch(85% 0.03 25)", color: "oklch(45% 0.17 25)", padding: "6px 14px", borderRadius: "8px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && results !== null && (
        <>
          <div style={{ fontSize: "13px", color: "oklch(48% 0.01 80)", marginBottom: "14px" }}>{visibleResults.length} result(s)</div>

          {visibleResults.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {visibleResults.map((doc) => {
                const hasFile = Boolean(storagePathById.get(doc.id));
                return (
                <div key={doc.id} style={{ background: "oklch(100% 0 0)", border: "1px solid oklch(92% 0.006 80)", borderRadius: "14px", padding: "20px 22px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "6px" }}>
                    <div style={{ fontSize: "17px", fontWeight: 700 }}>{doc.title}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                      {hasFile ? (
                        <a
                          href={`/api/documents/${doc.id}/download`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ background: "none", border: "none", color: "#272A77", fontSize: "12px", fontWeight: 600, cursor: "pointer", padding: "4px 8px", whiteSpace: "nowrap", textDecoration: "none" }}
                        >
                          Open document
                        </a>
                      ) : (
                        <span
                          title="No stored file for this document"
                          style={{ color: "oklch(70% 0.006 80)", fontSize: "12px", fontWeight: 600, padding: "4px 8px", whiteSpace: "nowrap" }}
                        >
                          Open document
                        </span>
                      )}
                      <button
                        onClick={() => onDeleteClick(doc.id)}
                        style={{ background: "none", border: "none", color: "oklch(55% 0.01 80)", fontSize: "12px", fontWeight: 600, cursor: "pointer", padding: "4px 8px", whiteSpace: "nowrap" }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div style={{ fontSize: "14.5px", color: "oklch(38% 0.01 80)", lineHeight: 1.55, marginBottom: "14px" }}>{doc.snippet}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    <MetaBadge value={doc.client} label="Client" background="#EEF0FA" color="#33377D" />
                    <span style={{ fontSize: "11.5px", fontWeight: 600, padding: "4px 10px", borderRadius: "999px", background: "oklch(95% 0.006 80)", color: "oklch(40% 0.01 80)" }}>{doc.document_type}</span>
                    <span style={{ fontSize: "11.5px", fontWeight: 600, padding: "4px 10px", borderRadius: "999px", background: "oklch(95% 0.006 80)", color: "oklch(40% 0.01 80)" }}>{doc.date_created}</span>
                    <MetaBadge value={doc.author} label="Author" background="oklch(95% 0.006 80)" color="oklch(40% 0.01 80)" />
                    <span style={{ fontSize: "11.5px", fontWeight: 600, padding: "4px 10px", borderRadius: "999px", background: "oklch(95% 0.006 80)", color: "oklch(40% 0.01 80)" }}>{formatFromTitle(doc.title)}</span>
                  </div>
                  {confirmDeleteId === doc.id && (
                    <div style={{ marginTop: "14px", paddingTop: "14px", borderTop: "1px solid oklch(92% 0.006 80)", display: "flex", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
                      <span style={{ fontSize: "12.5px", color: "oklch(45% 0.17 25)" }}>
                        Delete this document? This can&apos;t be undone — past answers that cited it will show as unavailable.
                      </span>
                      <button
                        onClick={() => onConfirmDelete(doc.id)}
                        style={{ background: "oklch(50% 0.17 25)", color: "oklch(99% 0.01 80)", border: "none", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                      >
                        Confirm delete
                      </button>
                      <button
                        onClick={onCancelDelete}
                        style={{ background: "none", border: "1px solid oklch(85% 0.006 80)", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                      >
                        Cancel
                      </button>
                      {deleteError && <span style={{ fontSize: "12.5px", color: "oklch(45% 0.17 25)", fontWeight: 600 }}>{deleteError}</span>}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
          {visibleResults.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "oklch(48% 0.01 80)" }}>
              <div style={{ fontSize: "15px", fontWeight: 600, marginBottom: "6px" }}>No documents match your search or filters</div>
              <div style={{ fontSize: "13.5px" }}>Try broadening your filters or using different search terms.</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
