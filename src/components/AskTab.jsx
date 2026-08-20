import ReactMarkdown from "react-markdown";

// Blank Client on a citation reads as "field intentionally empty" rather
// than missing/broken data — same muted-italic treatment already used for
// the "Source document no longer available" citation state below. Names the
// field explicitly (not just "Not specified") since the citation line has
// no column header to imply which field is blank.
function formatOptionalMeta(value) {
  return value || <span style={{ fontStyle: "italic", color: "oklch(70% 0.006 80)" }}>Client not specified</span>;
}

// Assistant answers are markdown (see the /api/ask system prompt's
// formatting instruction) — override element spacing/sizing so bullets,
// paragraphs, and bold fit the chat bubble's existing 14.5px/1.6 typography
// instead of the browser's default block margins.
const markdownComponents = {
  p: ({ children }) => <p style={{ margin: "0 0 8px", lineHeight: 1.6 }}>{children}</p>,
  ul: ({ children }) => <ul style={{ margin: "0 0 8px", paddingLeft: "20px", lineHeight: 1.6 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: "0 0 8px", paddingLeft: "20px", lineHeight: 1.6 }}>{children}</ol>,
  li: ({ children }) => <li style={{ marginBottom: "3px" }}>{children}</li>,
  strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
};

export default function AskTab({ documents, chatMessages, chatInput, setChatInput, isThinking, sendChat, onRetry, goUpload }) {
  if (documents.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "100px 20px" }}>
        <div style={{ fontSize: "19px", fontWeight: 700, marginBottom: "8px" }}>Ask isn&apos;t ready yet</div>
        <div style={{ fontSize: "14.5px", color: "oklch(48% 0.01 80)", maxWidth: "480px", margin: "0 auto 24px", lineHeight: 1.6 }}>
          Answers here are grounded only in documents uploaded to this knowledge base — nothing else. With no documents indexed yet, there&apos;s nothing to answer from.
        </div>
        <button
          onClick={goUpload}
          style={{ background: "#272A77", color: "oklch(99% 0.01 80)", border: "none", padding: "12px 24px", borderRadius: "10px", fontSize: "14.5px", fontWeight: 700, cursor: "pointer" }}
        >
          Go to Upload
        </button>
      </div>
    );
  }

  const noChatMessages = chatMessages.length === 0;
  const messages = chatMessages.map((m) => {
    const citations = (m.citations || []).map((c) => {
      const matchedDocument = documents.find((d) => d.id === c.documentId);
      const available = Boolean(matchedDocument);
      const hasFile = Boolean(matchedDocument?.storage_path);
      return { ...c, available, unavailable: !available, hasFile };
    });
    return {
      ...m,
      isUser: m.role === "user",
      isAssistant: m.role === "assistant",
      isError: m.role === "error",
      citations,
      hasCitations: citations.length > 0,
    };
  });

  const sendDisabled = !(chatInput.trim().length > 0) || isThinking;
  const sendBtnStyle = {
    background: sendDisabled ? "oklch(90% 0.006 80)" : "#272A77",
    color: sendDisabled ? "oklch(60% 0.01 80)" : "oklch(99% 0.01 80)",
    border: "none",
    padding: "0 26px",
    borderRadius: "12px",
    fontSize: "14px",
    fontWeight: 700,
    cursor: sendDisabled ? "default" : "pointer",
  };

  const chatKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
      {noChatMessages && (
        <div style={{ textAlign: "center", padding: "50px 20px", color: "oklch(48% 0.01 80)", fontSize: "14px", maxWidth: "460px", margin: "0 auto", lineHeight: 1.6 }}>
          Answers are grounded in your {documents.length} indexed document(s), with numbered citations back to the source. Ask a question to get started.
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "18px", flex: 1, marginBottom: "20px" }}>
        {messages.map((m) => (
          <div key={m.id}>
            {m.isUser && (
              <div
                style={{
                  alignSelf: "flex-end",
                  maxWidth: "70%",
                  background: "#272A77",
                  color: "oklch(99% 0.01 80)",
                  padding: "12px 16px",
                  borderRadius: "14px 14px 2px 14px",
                  fontSize: "14.5px",
                  lineHeight: 1.5,
                }}
              >
                {m.text}
              </div>
            )}
            {m.isAssistant && (
              <div style={{ alignSelf: "flex-start", maxWidth: "78%" }}>
                <div style={{ background: "oklch(100% 0 0)", border: "1px solid oklch(92% 0.006 80)", padding: "14px 18px", borderRadius: "14px 14px 14px 2px", fontSize: "14.5px", lineHeight: 1.6 }}>
                  <ReactMarkdown components={markdownComponents}>{m.text}</ReactMarkdown>
                </div>
                {m.hasCitations && (
                  <div style={{ marginTop: "8px", paddingLeft: "6px", display: "flex", flexDirection: "column", gap: "6px" }}>
                    <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "oklch(52% 0.01 80)" }}>Sources</div>
                    {m.citations.map((c) => (
                      <div key={c.n}>
                        {c.available && c.hasFile && (
                          <a
                            href={`/api/documents/${c.documentId}/download`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: "block",
                              textAlign: "left",
                              background: "oklch(97% 0.006 80)",
                              border: "1px solid oklch(91% 0.006 80)",
                              borderRadius: "8px",
                              padding: "8px 12px",
                              fontSize: "12.5px",
                              cursor: "pointer",
                              color: "oklch(30% 0.01 80)",
                              textDecoration: "none",
                            }}
                          >
                            <span style={{ fontWeight: 700, color: "#33377D" }}>[{c.n}]</span> {c.title} — {formatOptionalMeta(c.client)} · {c.documentType} · {c.dateCreated}
                          </a>
                        )}
                        {c.available && !c.hasFile && (
                          <div
                            title="No stored file for this document"
                            style={{
                              textAlign: "left",
                              background: "oklch(97% 0.006 80)",
                              border: "1px solid oklch(91% 0.006 80)",
                              borderRadius: "8px",
                              padding: "8px 12px",
                              fontSize: "12.5px",
                              color: "oklch(48% 0.01 80)",
                            }}
                          >
                            <span style={{ fontWeight: 700, color: "#33377D" }}>[{c.n}]</span> {c.title} — {formatOptionalMeta(c.client)} · {c.documentType} · {c.dateCreated}
                          </div>
                        )}
                        {c.unavailable && (
                          <div
                            style={{
                              textAlign: "left",
                              background: "oklch(96% 0.006 80)",
                              border: "1px dashed oklch(85% 0.006 80)",
                              borderRadius: "8px",
                              padding: "8px 12px",
                              fontSize: "12.5px",
                              color: "oklch(55% 0.01 80)",
                              fontStyle: "italic",
                            }}
                          >
                            <span style={{ fontWeight: 700 }}>[{c.n}]</span> Source document no longer available
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {m.isError && (
              <div style={{ alignSelf: "flex-start", maxWidth: "78%", background: "oklch(98% 0.015 25)", border: "1px solid oklch(85% 0.03 25)", padding: "14px 18px", borderRadius: "14px 14px 14px 2px" }}>
                <div style={{ fontSize: "14px", color: "oklch(45% 0.17 25)", marginBottom: "10px" }}>{m.text}</div>
                <button
                  onClick={onRetry}
                  style={{ background: "none", border: "1px solid oklch(85% 0.03 25)", color: "oklch(45% 0.17 25)", padding: "6px 14px", borderRadius: "8px", fontSize: "12.5px", fontWeight: 600, cursor: "pointer" }}
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        ))}
        {isThinking && (
          <div style={{ alignSelf: "flex-start", background: "oklch(100% 0 0)", border: "1px solid oklch(92% 0.006 80)", padding: "14px 18px", borderRadius: "14px 14px 14px 2px" }}>
            <span style={{ animation: "pulse 1.2s infinite" }}>●</span> <span style={{ animation: "pulse 1.2s infinite 0.2s" }}>●</span>{" "}
            <span style={{ animation: "pulse 1.2s infinite 0.4s" }}>●</span>
          </div>
        )}
      </div>
      <div style={{ position: "sticky", bottom: "16px", background: "oklch(98.3% 0.004 80)", paddingTop: "8px" }}>
        <div style={{ fontSize: "11.5px", color: "oklch(58% 0.01 80)", textAlign: "center", marginBottom: "6px" }}>
          This conversation isn&apos;t saved — it&apos;ll be gone if you leave or refresh this page.
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={chatKeyDown}
            placeholder="Ask a question about your knowledge base…"
            style={{ flex: 1, padding: "14px 18px", fontSize: "14.5px", border: "1px solid oklch(88% 0.006 80)", borderRadius: "12px", background: "oklch(100% 0 0)", outline: "none" }}
          />
          <button onClick={() => sendChat()} disabled={sendDisabled} style={sendBtnStyle}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
