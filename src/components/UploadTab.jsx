import { DOC_TYPES, INDUSTRIES } from "@/lib/constants";
import { ERROR_KIND } from "@/lib/friendlyErrors";

// Retrying resubmits the exact same file — pointless for failure kinds that
// will deterministically fail again (wrong type, too large).
const NON_RETRYABLE_KINDS = new Set([ERROR_KIND.UNSUPPORTED_TYPE, ERROR_KIND.TOO_LARGE]);

const STATUS_LABELS = { parsing: "Parsing…", indexing: "Indexing…" };
const PROGRESS_PCT = { parsing: 35, indexing: 78 };

function cardColors(status) {
  if (status === "invalid" || status === "failed") return { border: "oklch(85% 0.03 25)", bg: "oklch(98% 0.015 25)" };
  if (status === "duplicate") return { border: "#B7BBE3", bg: "#F2F3FA" };
  if (status === "complete") return { border: "oklch(85% 0.04 145)", bg: "oklch(98% 0.015 145)" };
  return { border: "oklch(92% 0.006 80)", bg: "oklch(100% 0 0)" };
}

export default function UploadTab({
  uploadFiles,
  dragActive,
  handleDrop,
  handleDragOver,
  handleDragLeave,
  handleFilesInput,
  dismissFile,
  updateMeta,
  submitMetadata,
  resolveDuplicate,
}) {
  const dropzoneStyle = {
    border: `2px dashed ${dragActive ? "#272A77" : "oklch(85% 0.006 80)"}`,
    borderRadius: "16px",
    padding: "48px 24px",
    textAlign: "center",
    background: dragActive ? "#F2F3FA" : "oklch(100% 0 0)",
    transition: "all 0.15s ease",
  };

  return (
    <div>
      <div style={dropzoneStyle} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
        <div style={{ fontSize: "16px", fontWeight: 700, marginBottom: "6px" }}>Drag and drop files here</div>
        <div style={{ fontSize: "13.5px", color: "oklch(48% 0.01 80)", marginBottom: "16px" }}>or</div>
        <label style={{ display: "inline-block", background: "#272A77", color: "oklch(99% 0.01 80)", padding: "11px 22px", borderRadius: "10px", fontSize: "14px", fontWeight: 700, cursor: "pointer" }}>
          Browse files
          <input type="file" multiple onChange={handleFilesInput} style={{ display: "none" }} />
        </label>
        <div style={{ fontSize: "12px", color: "oklch(56% 0.01 80)", marginTop: "16px" }}>
          Accepted: PDF, DOCX, PPTX, XLSX, CSV, TXT, and images (JPG, PNG) · Max 25 MB per file
        </div>
      </div>

      {uploadFiles.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "24px" }}>
          {[...uploadFiles].sort((a, b) => a.name.localeCompare(b.name)).map((file) => {
            const isProcessing = file.status === "parsing" || file.status === "indexing";
            const submitDisabled = !(file.meta && file.meta.type && file.meta.industry && file.meta.date);
            const colors = cardColors(file.status);
            const cardStyle = { background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: "14px", padding: "18px 20px" };
            const submitBtnStyle = {
              background: submitDisabled ? "oklch(90% 0.006 80)" : "#272A77",
              color: submitDisabled ? "oklch(60% 0.01 80)" : "oklch(99% 0.01 80)",
              border: "none",
              padding: "10px 18px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 700,
              cursor: submitDisabled ? "default" : "pointer",
            };
            const progressBarStyle = {
              height: "100%",
              width: `${PROGRESS_PCT[file.status] || 0}%`,
              background: "#272A77",
              borderRadius: "999px",
              transition: "width 0.6s ease",
            };

            return (
              <div key={file.id} style={cardStyle}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                  <div style={{ fontWeight: 700, fontSize: "14.5px" }}>{file.name}</div>
                  <div style={{ fontSize: "12px", color: "oklch(52% 0.01 80)" }}>{file.sizeLabel}</div>
                </div>

                {file.status === "invalid" && (
                  <div>
                    <div style={{ fontSize: "13px", color: "oklch(45% 0.17 25)", margin: "8px 0 10px" }}>{file.error}</div>
                    <button
                      onClick={() => dismissFile(file.id)}
                      style={{ background: "none", border: "1px solid oklch(85% 0.02 25)", color: "oklch(45% 0.17 25)", padding: "6px 14px", borderRadius: "8px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer" }}
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {file.status === "duplicate" && (
                  <div>
                    <div style={{ fontSize: "13px", color: "#3A3E82", margin: "8px 0 6px" }}>
                      A document from this file already exists in the knowledge base (indexed {file.existingDocument?.created_at?.slice(0, 10)}). What would you like to do?
                    </div>
                    <div style={{ fontSize: "12px", color: "oklch(45% 0.17 25)", marginBottom: "12px" }}>Replacing permanently removes the existing document and can&apos;t be undone.</div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        onClick={() => resolveDuplicate(file.id, "replace")}
                        style={{ background: "#272A77", color: "oklch(99% 0.01 80)", border: "none", padding: "8px 14px", borderRadius: "8px", fontSize: "12.5px", fontWeight: 700, cursor: "pointer" }}
                      >
                        Replace
                      </button>
                      <button
                        onClick={() => resolveDuplicate(file.id, "skip")}
                        style={{ background: "none", border: "none", color: "oklch(48% 0.01 80)", padding: "8px 14px", borderRadius: "8px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer" }}
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                )}

                {file.status === "metadata" && (
                  <div style={{ marginTop: "10px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "14px" }}>
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "oklch(45% 0.01 80)", marginBottom: "5px" }}>Client Name</div>
                        <input
                          type="text"
                          value={file.meta.client}
                          onChange={(e) => updateMeta(file.id, "client", e.target.value)}
                          placeholder="e.g. Meridian Retail Group"
                          style={{ width: "100%", padding: "9px 11px", borderRadius: "8px", border: "1px solid oklch(88% 0.006 80)", fontSize: "13.5px" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "oklch(45% 0.01 80)", marginBottom: "5px" }}>
                          Document Type <span style={{ color: "oklch(55% 0.19 25)" }}>*</span>
                        </div>
                        <select
                          value={file.meta.type}
                          onChange={(e) => updateMeta(file.id, "type", e.target.value)}
                          style={{ width: "100%", padding: "9px 11px", borderRadius: "8px", border: "1px solid oklch(88% 0.006 80)", fontSize: "13.5px" }}
                        >
                          <option value="">Select type</option>
                          {DOC_TYPES.map((dt) => (
                            <option key={dt} value={dt}>
                              {dt}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "oklch(45% 0.01 80)", marginBottom: "5px" }}>Author</div>
                        <input
                          type="text"
                          value={file.meta.author}
                          onChange={(e) => updateMeta(file.id, "author", e.target.value)}
                          placeholder="e.g. J. Alvarez"
                          style={{ width: "100%", padding: "9px 11px", borderRadius: "8px", border: "1px solid oklch(88% 0.006 80)", fontSize: "13.5px" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "oklch(45% 0.01 80)", marginBottom: "5px" }}>
                          Topic / Product Category <span style={{ color: "oklch(55% 0.19 25)" }}>*</span>
                        </div>
                        <select
                          value={file.meta.industry}
                          onChange={(e) => updateMeta(file.id, "industry", e.target.value)}
                          style={{ width: "100%", padding: "9px 11px", borderRadius: "8px", border: "1px solid oklch(88% 0.006 80)", fontSize: "13.5px" }}
                        >
                          <option value="">Select topic / category</option>
                          {INDUSTRIES.map((ind) => (
                            <option key={ind} value={ind}>
                              {ind}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "oklch(45% 0.01 80)", marginBottom: "5px" }}>
                          Date Created <span style={{ color: "oklch(55% 0.19 25)" }}>*</span>
                        </div>
                        <input
                          type="date"
                          value={file.meta.date}
                          onChange={(e) => updateMeta(file.id, "date", e.target.value)}
                          style={{ width: "100%", padding: "8px 11px", borderRadius: "8px", border: "1px solid oklch(88% 0.006 80)", fontSize: "13.5px" }}
                        />
                      </div>
                    </div>
                    <button onClick={() => submitMetadata(file.id)} disabled={submitDisabled} style={submitBtnStyle}>
                      Save &amp; start indexing
                    </button>
                  </div>
                )}

                {isProcessing && (
                  <div style={{ marginTop: "10px" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "8px" }}>{STATUS_LABELS[file.status] || ""}</div>
                    <div style={{ height: "6px", background: "oklch(93% 0.006 80)", borderRadius: "999px", overflow: "hidden" }}>
                      <div style={progressBarStyle}></div>
                    </div>
                  </div>
                )}

                {file.status === "complete" && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px", fontSize: "13px", color: "oklch(38% 0.14 145)", fontWeight: 600 }}>
                    <span>✓ Indexed and searchable</span>
                  </div>
                )}

                {file.status === "failed" && (
                  <div style={{ marginTop: "8px" }}>
                    <div style={{ fontSize: "13px", color: "oklch(45% 0.17 25)", marginBottom: "10px" }}>{file.error}</div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      {!NON_RETRYABLE_KINDS.has(file.errorKind) && (
                        <button
                          onClick={() => submitMetadata(file.id)}
                          style={{ background: "#272A77", color: "oklch(99% 0.01 80)", border: "none", padding: "6px 14px", borderRadius: "8px", fontSize: "12.5px", fontWeight: 700, cursor: "pointer" }}
                        >
                          Retry
                        </button>
                      )}
                      <button
                        onClick={() => dismissFile(file.id)}
                        style={{ background: "none", border: "1px solid oklch(85% 0.02 25)", color: "oklch(45% 0.17 25)", padding: "6px 14px", borderRadius: "8px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer" }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
