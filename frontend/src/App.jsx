import { useEffect, useRef, useState } from "react";
import Tool from "./PagemarkTool.jsx";

const API = import.meta.env.DEV ? "http://localhost:8000" : "";

export default function App() {
  const [activeTab, setActiveTab] = useState("mentor"); // "mentor" | "pagemark"
  const [health, setHealth] = useState(null);
  const [packs, setPacks] = useState([]);
  const [packId, setPackId] = useState("tk-d");
  const [messages, setMessages] = useState([]);
  const [activeMsgIdx, setActiveMsgIdx] = useState(-1);
  const [activeCiteIdx, setActiveCiteIdx] = useState(0);
  const [inputVal, setInputVal] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const logBottomRef = useRef(null);

  const fetchPacks = () => {
    fetch(`${API}/packs`)
      .then((res) => res.json())
      .then((data) => {
        setPacks(data);
        if (data.length && !data.find((p) => p.id === packId)) {
          setPackId(data[0].id);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    const checkHealth = () => {
      fetch(`${API}/health`)
        .then((res) => res.json())
        .then(setHealth)
        .catch(() => setHealth(null));
    };
    checkHealth();
    fetchPacks();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const updateMessage = (index, updater) => {
    setMessages((prev) => prev.map((msg, i) => (i === index ? updater(msg) : msg)));
  };

  async function handleAsk(questionText) {
    const q = questionText.trim();
    if (!q || isBusy) return;

    const currentMsgIndex = messages.length;
    setInputVal("");
    setIsBusy(true);
    setActiveMsgIdx(currentMsgIndex);
    setActiveCiteIdx(0);

    setMessages((prev) => [
      ...prev,
      { question: q, answer: "", citations: [], loading: true, latency: null, error: null }
    ]);

    try {
      const response = await fetch(`${API}/ask/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack_id: packId, question: q })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
          const rawLine = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!rawLine) continue;

          const event = JSON.parse(rawLine);
          if (event.type === "citations") {
            updateMessage(currentMsgIndex, (m) => ({ ...m, citations: event.citations }));
          } else if (event.type === "token") {
            updateMessage(currentMsgIndex, (m) => ({ ...m, answer: m.answer + event.text }));
          } else if (event.type === "error") {
            updateMessage(currentMsgIndex, (m) => ({ ...m, error: event.message }));
          } else if (event.type === "done") {
            updateMessage(currentMsgIndex, (m) => ({
              ...m,
              loading: false,
              latency: event.latency_ms
            }));
          }
        }
      }
    } catch (err) {
      updateMessage(currentMsgIndex, (m) => ({
        ...m,
        loading: false,
        error: String(err.message || err)
      }));
    } finally {
      updateMessage(currentMsgIndex, (m) => ({ ...m, loading: false }));
      setIsBusy(false);
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadStatus("Indexing document...");
    const formData = new FormData();
    formData.append("pack_id", packId);
    formData.append("file", file);

    try {
      const res = await fetch(`${API}/ingest`, { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Indexing failed");
      setUploadStatus(`Indexed ${data.chunks} passages from ${data.pages_parsed} pages.`);
      fetchPacks();
    } catch (err) {
      setUploadStatus(`Upload failed: ${err.message}`);
    }
    e.target.value = "";
  }

  const selectedPack = packs.find((p) => p.id === packId);
  const activeMessage = messages[activeMsgIdx];
  const activeCitation = activeMessage?.citations?.[activeCiteIdx];
  const isServerReady = health && health.ollama_ready;

  return (
    <div className="layout-root">
      {/* Top Header */}
      <header className="header-bar">
        <div className="brand-group">
          <span className="brand-title">BHASHA MENTOR</span>
          <span className="brand-divider">/</span>
          <span className="brand-sub">STUDY ASSISTANT</span>
        </div>

        <nav className="nav-tabs" aria-label="Mode Selection">
          <button
            type="button"
            className={`nav-btn ${activeTab === "mentor" ? "active" : ""}`}
            onClick={() => setActiveTab("mentor")}
          >
            TEXTBOOK QA
          </button>
          <button
            type="button"
            className={`nav-btn ${activeTab === "pagemark" ? "active" : ""}`}
            onClick={() => setActiveTab("pagemark")}
          >
            PAGEMARK SEARCH
          </button>
        </nav>

        <div className="header-meta">
          <div className="status-indicator">
            <span className={`status-signal ${isServerReady ? "live" : "standby"}`} />
            <span className="status-text">
              {health === null
                ? "SERVER DISCONNECTED"
                : isServerReady
                ? "OFFLINE READY [CPU]"
                : "MODEL STANDBY"}
            </span>
          </div>

          {activeTab === "mentor" && (
            <div className="control-group">
              <select
                className="select-input"
                value={packId}
                onChange={(e) => setPackId(e.target.value)}
                aria-label="Select Content Pack"
              >
                {packs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
              <label className="action-btn upload-btn">
                UPLOAD PDF
                <input type="file" accept="application/pdf" onChange={handleFileUpload} hidden />
              </label>
            </div>
          )}
        </div>
      </header>

      {uploadStatus && <div className="system-banner">{uploadStatus}</div>}

      {/* Main Content Area */}
      {activeTab === "pagemark" ? (
        <main className="tool-container">
          <div className="tool-inner">
            <div className="section-header">
              <span className="section-tag">TOOL</span>
              <h2 className="section-title">LOCAL IN-BROWSER PAGE SEARCH</h2>
            </div>
            <Tool />
          </div>
        </main>
      ) : (
        <main className="workspace-grid">
          {/* Left Column: Chat & Dialogue */}
          <section className="dialogue-column" aria-label="Question and Answer Stream">
            <div className="dialogue-scroll">
              {messages.length === 0 && (
                <div className="placeholder-state">
                  <div className="placeholder-heading">NO ACTIVE DIALOGUE</div>
                  <p className="placeholder-desc">
                    Submit a query in Hindi or select one of the verified reference questions below.
                    Every answer is strictly mapped and citations are pinned to the verified PDF page.
                  </p>
                </div>
              )}

              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`dialogue-card ${idx === activeMsgIdx ? "selected" : ""}`}
                  onClick={() => {
                    setActiveMsgIdx(idx);
                    setActiveCiteIdx(0);
                  }}
                >
                  <div className="card-header">
                    <span className="entry-index">QUERY #{String(idx + 1).padStart(2, "0")}</span>
                    {m.latency != null && (
                      <span className="entry-latency">
                        {(m.latency / 1000).toFixed(1)}S LATENCY &middot; PAGE{" "}
                        {m.citations[0]?.page_number ?? "-"}
                      </span>
                    )}
                  </div>
                  <h3 className="query-text">{m.question}</h3>
                  {m.error && <div className="error-box">{m.error}</div>}
                  <div className="answer-text">
                    {m.answer}
                    {m.loading && <span className="cursor-block" />}
                  </div>
                </div>
              ))}
              <div ref={logBottomRef} />
            </div>

            {selectedPack?.sample_questions?.length > 0 && (
              <div className="samples-bar">
                <span className="samples-label">BENCHMARK QUERIES:</span>
                <div className="samples-list">
                  {selectedPack.sample_questions.map((q, idx) => (
                    <button
                      key={idx}
                      className="sample-btn"
                      disabled={isBusy}
                      onClick={() => handleAsk(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="input-bar">
              <input
                className="query-input"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAsk(inputVal)}
                placeholder="Type question in Hindi..."
                aria-label="Input Query"
              />
              <button
                className="action-btn submit-btn"
                disabled={isBusy || !inputVal.trim()}
                onClick={() => handleAsk(inputVal)}
              >
                {isBusy ? "PROCESSING" : "SUBMIT"}
              </button>
            </div>
          </section>

          {/* Right Column: Source Citation Verification */}
          <aside className="citation-column" aria-label="Source Document Citation">
            <div className="column-top-label">
              <span>DOCUMENT CITATION VERIFICATION</span>
            </div>

            {!activeCitation ? (
              <div className="citation-idle">
                <div className="idle-title">AWAITING QUERY EXECUTION</div>
                <p className="idle-sub">
                  When a question is processed, physical page verification and the exact passage
                  extracted from the text book will appear here.
                </p>
              </div>
            ) : (
              <div className="citation-details">
                <div className="page-metric-panel">
                  <div className="page-metric-label">VERIFIED PDF PAGE</div>
                  <div className="page-metric-number">
                    {String(activeCitation.page_number).padStart(2, "0")}
                  </div>
                </div>

                <div className="meta-row">
                  <span className="meta-label">SECTION:</span>
                  <span className="meta-val">
                    {activeCitation.chapter} &rarr; {activeCitation.topic}
                  </span>
                </div>

                <div className="meta-row">
                  <span className="meta-label">MATCH SCORE:</span>
                  <span className="meta-val">{(activeCitation.score * 100).toFixed(1)}%</span>
                </div>

                <div className="passage-card">
                  <span className="passage-tag">EXTRACTED PASSAGE</span>
                  <blockquote className="passage-body">{activeCitation.snippet}</blockquote>
                </div>

                <div className="footnote-alert">
                  Citations are extracted directly via PyMuPDF coordinate geometry and are locked
                  against hallucination.
                </div>

                {activeMessage.citations.length > 1 && (
                  <div className="alternative-citations">
                    <span className="alt-title">ALTERNATIVE PASSAGES CONSIDERED:</span>
                    <div className="alt-list">
                      {activeMessage.citations.map((c, i) => (
                        <button
                          key={i}
                          type="button"
                          className={`alt-card ${i === activeCiteIdx ? "active" : ""}`}
                          onClick={() => setActiveCiteIdx(i)}
                        >
                          <span className="alt-page">PAGE {c.page_number}</span>
                          <span className="alt-topic">{c.topic}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </aside>
        </main>
      )}
    </div>
  );
}
