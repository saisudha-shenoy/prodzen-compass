import { rowsToCsv, downloadCsv } from "@/lib/csv";

const filterLabelStyle = {
  fontSize: "10.5px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  color: "oklch(55% 0.01 80)",
};

const dateInputStyle = {
  padding: "7px 10px",
  borderRadius: "8px",
  border: "1px solid oklch(88% 0.006 80)",
  fontSize: "13px",
  background: "oklch(98% 0.004 80)",
};

const thStyle = {
  textAlign: "left",
  padding: "9px 12px",
  fontSize: "10.5px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  color: "oklch(55% 0.01 80)",
  borderBottom: "1px solid oklch(90% 0.006 80)",
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "10px 12px",
  fontSize: "13px",
  borderBottom: "1px solid oklch(94% 0.006 80)",
  verticalAlign: "top",
};

function truncate(text, maxLength = 140) {
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}…` : text;
}

function formatTimestamp(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

const CSV_HEADERS = [
  "Timestamp",
  "Type",
  "Query / Prompt",
  "Filters (Search)",
  "Retrieved Chunk IDs (Ask)",
  "Citations (Ask)",
  "Answer (Ask)",
  "Latency (ms)",
  "Feedback",
];

function rowToCsvValues(row) {
  return [
    formatTimestamp(row.created_at),
    row.type,
    row.query ?? "",
    row.filters ? JSON.stringify(row.filters) : "",
    row.retrieved_chunk_ids ? JSON.stringify(row.retrieved_chunk_ids) : "",
    row.citations ? JSON.stringify(row.citations) : "",
    row.answer ?? "",
    row.latency_ms ?? "",
    row.feedback ?? "",
  ];
}

export default function ActivityLogTab({ rows, isLoading, dateFrom, setDateFrom, dateTo, setDateTo }) {
  const exportCsv = () => {
    const csv = rowsToCsv(CSV_HEADERS, rows.map(rowToCsvValues));
    downloadCsv(`activity-log_${dateFrom || "all"}_to_${dateTo || "all"}.csv`, csv);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <div style={{ fontSize: "19px", fontWeight: 700 }}>Activity Log</div>
        <div style={{ fontSize: "13px", color: "oklch(48% 0.01 80)", marginTop: "2px" }}>
          Every Search and Ask call, with filters, retrieved citations, latency, and feedback.
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: "16px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={filterLabelStyle}>From</span>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={dateInputStyle} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={filterLabelStyle}>To</span>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={dateInputStyle} />
        </div>
        <button
          onClick={exportCsv}
          disabled={rows.length === 0}
          style={{
            padding: "9px 18px",
            borderRadius: "8px",
            border: "none",
            fontSize: "13.5px",
            fontWeight: 700,
            cursor: rows.length === 0 ? "default" : "pointer",
            background: rows.length === 0 ? "oklch(90% 0.006 80)" : "#272A77",
            color: rows.length === 0 ? "oklch(60% 0.01 80)" : "oklch(99% 0.01 80)",
          }}
        >
          Download CSV
        </button>
        <div style={{ fontSize: "12.5px", color: "oklch(55% 0.01 80)" }}>
          {isLoading ? "Loading…" : `${rows.length} row${rows.length === 1 ? "" : "s"} in range`}
        </div>
      </div>

      <div style={{ border: "1px solid oklch(90% 0.006 80)", borderRadius: "12px", overflow: "auto", background: "oklch(100% 0 0)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Timestamp</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Query / Prompt</th>
              <th style={thStyle}>Latency</th>
              <th style={thStyle}>Citations</th>
              <th style={thStyle}>Feedback</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !isLoading && (
              <tr>
                <td style={{ ...tdStyle, color: "oklch(55% 0.01 80)" }} colSpan={6}>
                  No activity in this date range.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>{formatTimestamp(row.created_at)}</td>
                <td style={tdStyle}>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      padding: "2px 8px",
                      borderRadius: "999px",
                      background: row.type === "ask" ? "oklch(93% 0.03 280)" : "oklch(93% 0.03 150)",
                      color: row.type === "ask" ? "#33377D" : "oklch(35% 0.08 150)",
                    }}
                  >
                    {row.type}
                  </span>
                </td>
                <td style={tdStyle}>{truncate(row.query)}</td>
                <td style={tdStyle}>{row.latency_ms != null ? `${row.latency_ms} ms` : ""}</td>
                <td style={tdStyle}>{row.citations ? row.citations.length : row.filters ? "—" : ""}</td>
                <td style={tdStyle}>{row.feedback ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
