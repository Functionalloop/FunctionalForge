import { useEffect, useRef, useState } from "react";
import Tool from "./PagemarkTool.jsx";
import { translations } from "./locales.js";

const API = import.meta.env.DEV ? "http://localhost:8000" : "";

export default function App() {
  const [lang, setLang] = useState("en"); // Default language is English ("en" | "hi")
  const t = translations[lang] || translations.en;

  const [activeTab, setActiveTab] = useState("mentor"); // "mentor" | "benchmark" | "pagemark"
  const [health, setHealth] = useState(null);
  const [packs, setPacks] = useState([]);
  const [packId, setPackId] = useState("tk-d");
  const [messages, setMessages] = useState([]);
  const [activeMsgIdx, setActiveMsgIdx] = useState(-1);
  const [activeCiteIdx, setActiveCiteIdx] = useState(0);
  const [inputVal, setInputVal] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [searchStep, setSearchStep] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");

  // PDF Page viewer state
  const [pageNumber, setPageNumber] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [pageImageLoading, setPageImageLoading] = useState(false);
  const [pageImageError, setPageImageError] = useState(false);
  const [showRawDebug, setShowRawDebug] = useState(false);
  const [showFallbacks, setShowFallbacks] = useState(false);

  // Benchmarks state
  const [benchmarks, setBenchmarks] = useState([]);
  const [benchResults, setBenchResults] = useState({});
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [benchProgress, setBenchProgress] = useState({ current: 0, total: 0 });

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

  const fetchBenchmarks = () => {
    fetch(`${API}/benchmarks`)
      .then((res) => res.json())
      .then((data) => setBenchmarks(data))
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
    fetchBenchmarks();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, searchStep]);

  useEffect(() => {
    const activeMsg = messages[activeMsgIdx];
    const cite = activeMsg?.citations?.[activeCiteIdx];
    if (cite?.page_number) {
      setPageNumber(cite.page_number);
    }
  }, [activeMsgIdx, activeCiteIdx, messages]);

  useEffect(() => {
    setPageImageError(false);
    setPageImageLoading(true);
  }, [packId, pageNumber]);

  const updateMessage = (index, updater) => {
    setMessages((prev) => prev.map((msg, i) => (i === index ? updater(msg) : msg)));
  };

  const isAnswerUnavailable = (text) => {
    if (!text) return false;
    const lower = text.toLowerCase();
    return (
      lower.includes("उपलब्ध नहीं") ||
      lower.includes("नहीं मिला") ||
      lower.includes("जानकारी नहीं") ||
      lower.includes("not available") ||
      lower.includes("सूत्र नहीं है")
    );
  };

  async function handleAsk(questionText) {
    const q = questionText.trim();
    if (!q || isBusy) return;

    const currentMsgIndex = messages.length;
    setInputVal("");
    setIsBusy(true);
    setSearchStep(t.stepSearching);
    setActiveMsgIdx(currentMsgIndex);
    setActiveCiteIdx(0);
    setShowFallbacks(false);

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

      setSearchStep(t.stepReading);

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
            if (event.citations?.[0]?.page_number) {
              setPageNumber(event.citations[0].page_number);
            }
            setSearchStep(t.stepAnswering);
          } else if (event.type === "token") {
            setSearchStep("");
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
      setSearchStep("");
      updateMessage(currentMsgIndex, (m) => ({ ...m, loading: false }));
      setIsBusy(false);
    }
  }

  async function runAllBenchmarks() {
    if (isRunningAll || !benchmarks.length) return;
    setIsRunningAll(true);
    setBenchProgress({ current: 0, total: benchmarks.length });

    const newResults = { ...benchResults };

    for (let i = 0; i < benchmarks.length; i++) {
      const item = benchmarks[i];
      setBenchProgress({ current: i + 1, total: benchmarks.length });

      try {
        const res = await fetch(`${API}/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pack_id: packId, question: item.question })
        });
        const data = await res.json();
        const topPage = data.citations?.[0]?.page_number;
        const pass = topPage === item.expected_page;
        newResults[item.question] = {
          expected: item.expected_page,
          got: topPage,
          pass,
          latency: data.latency_ms,
          answer: data.answer
        };
      } catch (e) {
        newResults[item.question] = {
          expected: item.expected_page,
          got: null,
          pass: false,
          error: e.message
        };
      }
      setBenchResults({ ...newResults });
    }
    setIsRunningAll(false);
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
      setUploadStatus(`Indexed ${data.chunks} ${t.passages} from ${data.pages_parsed} ${t.pages}.`);
      fetchPacks();
    } catch (err) {
      setUploadStatus(`Upload failed: ${err.message}`);
    }
    e.target.value = "";
  }

  const handleInputKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAsk(inputVal);
    }
  };

  const selectedPack = packs.find((p) => p.id === packId);
  const bookOffset = selectedPack?.book_page_offset ?? 314;
  const totalBookPages = selectedPack?.total_pages ?? 20;

  const activeMessage = messages[activeMsgIdx];
  const activeCitation = activeMessage?.citations?.[activeCiteIdx];
  const isServerReady = health && health.ollama_ready;
  const isUnavailable = activeMessage && isAnswerUnavailable(activeMessage.answer);

  const benchEvaluated = Object.values(benchResults);
  const benchCorrect = benchEvaluated.filter((b) => b.pass).length;
  const benchAvgLatency = benchEvaluated.length
    ? Math.round(benchEvaluated.reduce((acc, curr) => acc + (curr.latency || 0), 0) / benchEvaluated.length / 1000)
    : 0;

  const renderAnswerWithCitations = (answerText, citations = []) => {
    if (!citations.length) return answerText;
    return (
      <div className="answer-paragraph">
        {answerText}
        <div className="evidence-tags">
          <span className="evidence-title">{t.sourcesTitle}</span>
          {citations.map((c, i) => (
            <button
              key={i}
              type="button"
              className={`cite-marker ${i === activeCiteIdx ? "active" : ""}`}
              onClick={() => {
                setActiveCiteIdx(i);
                setPageNumber(c.page_number);
              }}
              title={`Page ${c.page_number} (${c.topic})`}
            >
              [{i + 1}] PDF p.{c.page_number} &middot; Book p.{c.page_number + bookOffset}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="layout-root">
      {/* Top Header */}
      <header className="header-bar">
        <div className="brand-group">
          <span className="brand-title">{t.brandTitle}</span>
          <span className="brand-divider">/</span>
          <span className="brand-sub">{t.brandSub}</span>
        </div>

        <nav className="nav-tabs" aria-label="Mode Selection">
          <button
            type="button"
            className={`nav-btn ${activeTab === "mentor" ? "active" : ""}`}
            onClick={() => setActiveTab("mentor")}
          >
            {t.tabQa}
          </button>
          <button
            type="button"
            className={`nav-btn ${activeTab === "benchmark" ? "active" : ""}`}
            onClick={() => setActiveTab("benchmark")}
          >
            {t.tabBench}
          </button>
          <button
            type="button"
            className={`nav-btn ${activeTab === "pagemark" ? "active" : ""}`}
            onClick={() => setActiveTab("pagemark")}
          >
            {t.tabPagemark}
          </button>
        </nav>

        <div className="header-meta">
          {/* Language Selector */}
          <div className="lang-switcher">
            <button
              type="button"
              className={`lang-btn ${lang === "en" ? "active" : ""}`}
              onClick={() => setLang("en")}
              title="Switch UI to English"
            >
              EN
            </button>
            <span className="lang-sep">|</span>
            <button
              type="button"
              className={`lang-btn ${lang === "hi" ? "active" : ""}`}
              onClick={() => setLang("hi")}
              title="हिंदी में बदलें"
            >
              हिन्दी
            </button>
          </div>

          <div className="status-indicator">
            <span className={`status-signal ${isServerReady ? "live" : "standby"}`} />
            <span className="status-text">
              {health === null
                ? t.serverOffline
                : isServerReady
                ? t.offlineReady
                : t.modelStandby}
            </span>
          </div>

          <div className="doc-controls-group">
            <select
              className="select-input"
              value={packId}
              onChange={(e) => setPackId(e.target.value)}
              aria-label="Select Content Pack"
            >
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.chunks} {t.passages} &middot; {p.total_pages || 20} {t.pages})
                </option>
              ))}
            </select>
            <label className="action-btn upload-btn">
              {t.uploadPdf}
              <input type="file" accept="application/pdf" onChange={handleFileUpload} hidden />
            </label>
          </div>
        </div>
      </header>

      {uploadStatus && <div className="system-banner">{uploadStatus}</div>}

      {/* Main Mode View */}
      {activeTab === "pagemark" ? (
        <main className="tool-container">
          <div className="tool-inner">
            <div className="section-header">
              <span className="section-tag">{t.localToolTag}</span>
              <h2 className="section-title">{t.localToolTitle}</h2>
            </div>
            <Tool />
          </div>
        </main>
      ) : activeTab === "benchmark" ? (
        <main className="benchmark-container">
          <div className="benchmark-inner">
            <div className="bench-header-row">
              <div>
                <span className="section-tag">{t.evalTag}</span>
                <h2 className="section-title">{t.evalTitle}</h2>
                <p className="bench-desc">{t.evalDesc}</p>
              </div>
              <div className="bench-actions">
                <button
                  type="button"
                  className="action-btn run-all-btn"
                  disabled={isRunningAll}
                  onClick={runAllBenchmarks}
                >
                  {isRunningAll
                    ? `${t.runningBtn} (${benchProgress.current}/${benchProgress.total})`
                    : t.runAllBtn}
                </button>
              </div>
            </div>

            {benchEvaluated.length > 0 && (
              <div className="bench-stats-bar">
                <div className="stat-pill">
                  <span className="stat-label">{t.accuracyLabel}</span>
                  <span className="stat-value">{benchCorrect} / {benchEvaluated.length} CORRECT</span>
                </div>
                <div className="stat-pill">
                  <span className="stat-label">{t.avgLatencyLabel}</span>
                  <span className="stat-value">{benchAvgLatency} SECONDS</span>
                </div>
              </div>
            )}

            <div className="bench-table">
              <div className="bench-thead">
                <span className="col-q">{t.colQuery}</span>
                <span className="col-page">{t.colExpPage}</span>
                <span className="col-got">{t.colGotPage}</span>
                <span className="col-status">{t.colStatus}</span>
                <span className="col-lat">{t.colLatency}</span>
              </div>
              {benchmarks.map((item, i) => {
                const res = benchResults[item.question];
                return (
                  <div key={i} className="bench-trow">
                    <div className="col-q">
                      <strong>Q{i + 1}:</strong> {item.question}
                    </div>
                    <div className="col-page">
                      PDF p.{item.expected_page} (Book p.{item.expected_page + bookOffset})
                    </div>
                    <div className="col-got">
                      {res ? (res.got ? `PDF p.${res.got}` : "None") : "—"}
                    </div>
                    <div className="col-status">
                      {!res ? (
                        <span className="status-chip pending">{t.statusPending}</span>
                      ) : res.pass ? (
                        <span className="status-chip pass">{t.statusPass}</span>
                      ) : (
                        <span className="status-chip fail">
                          {t.statusFail} (Exp p.{res.expected}, Got p.{res.got})
                        </span>
                      )}
                    </div>
                    <div className="col-lat">
                      {res?.latency != null ? `${(res.latency / 1000).toFixed(1)}s` : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      ) : (
        <main className="workspace-grid">
          {/* Left Column: Chat Dialogue */}
          <section className="dialogue-column" aria-label="Questions and Dialogue Stream">
            <div className="dialogue-scroll">
              {messages.length === 0 && (
                <div className="placeholder-state">
                  <div className="placeholder-heading">{t.noDialogueTitle}</div>
                  <p className="placeholder-desc">{t.noDialogueDesc}</p>
                </div>
              )}

              {messages.map((m, idx) => {
                const msgUnavailable = isAnswerUnavailable(m.answer);
                return (
                  <div
                    key={idx}
                    className={`dialogue-card ${idx === activeMsgIdx ? "selected" : ""} ${
                      msgUnavailable ? "unavailable-card" : ""
                    }`}
                    onClick={() => {
                      setActiveMsgIdx(idx);
                      setActiveCiteIdx(0);
                    }}
                  >
                    <div className="card-header">
                      <span className="entry-index">{t.queryIndexPrefix} #{String(idx + 1).padStart(2, "0")}</span>
                      {m.latency != null && (
                        <span className="entry-latency">
                          {t.latencyPrefix} {(m.latency / 1000).toFixed(1)}s &middot; PDF p.
                          {m.citations[0]?.page_number ?? "-"}
                        </span>
                      )}
                    </div>

                    <h3 className="query-text">{m.question}</h3>
                    {m.error && <div className="error-box">{m.error}</div>}

                    {/* Failure state */}
                    {msgUnavailable ? (
                      <div className="unavailable-alert">
                        <div className="alert-head">
                          <span className="alert-icon">[!]</span>
                          <span>{t.infoNotInBook}</span>
                        </div>
                        <p className="alert-body">{t.infoNotInBookDesc}</p>
                        <button
                          type="button"
                          className="ghost-btn-small"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowFallbacks(true);
                          }}
                        >
                          {t.showClosestBtn}
                        </button>
                      </div>
                    ) : (
                      <div className="answer-text">
                        {renderAnswerWithCitations(m.answer, m.citations)}
                        {m.loading && <span className="cursor-block" />}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Progress Indicator Skeleton */}
              {isBusy && searchStep && (
                <div className="loading-card-skeleton">
                  <div className="step-badge">
                    <span className="step-spinner" />
                    <span>{searchStep}</span>
                  </div>
                  <div className="skeleton-line" />
                  <div className="skeleton-line short" />
                </div>
              )}

              <div ref={logBottomRef} />
            </div>

            {/* Benchmark Sample Chips */}
            {selectedPack?.sample_questions?.length > 0 && (
              <div className="samples-bar">
                <span className="samples-label">{t.benchmarkQueriesTitle}</span>
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

            {/* Input Composer */}
            <div className="input-bar">
              <div className="input-field-wrapper">
                <textarea
                  className="query-input"
                  rows={2}
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder={t.inputPlaceholder}
                  aria-label="Input Query"
                />
                <div className="input-hints">
                  <span>{t.inputHint}</span>
                </div>
              </div>
              <button
                className={`action-btn submit-btn ${inputVal.trim() ? "ready" : "disabled"}`}
                disabled={isBusy || !inputVal.trim()}
                onClick={() => handleAsk(inputVal)}
              >
                {isBusy ? t.processingBtn : t.submitBtn}
              </button>
            </div>
          </section>

          {/* Right Column: PDF Page Viewer & Citation */}
          <aside className="citation-column" aria-label="Source Document Citation">
            <div className="column-top-label">
              <span>{t.retrievedFrom}</span>
            </div>

            {!activeCitation ? (
              <div className="citation-idle">
                <div className="idle-title">{t.awaitingQueryTitle}</div>
                <p className="idle-sub">{t.awaitingQueryDesc}</p>
              </div>
            ) : isUnavailable && !showFallbacks ? (
              <div className="citation-idle">
                <div className="idle-title">{t.noMatchEvidenceTitle}</div>
                <p className="idle-sub">{t.noMatchEvidenceDesc}</p>
              </div>
            ) : (
              <div className="citation-details">
                {activeCitation.section_warning && (
                  <div className="warning-banner">
                    <span className="warning-icon">[!]</span>
                    <span>{activeCitation.section_warning}</span>
                  </div>
                )}

                <div className="citation-meta-header">
                  <div className="page-pill">
                    <span className="page-main">PDF p.{pageNumber}</span>
                    <span className="page-sub">&middot; Book p.{pageNumber + bookOffset}</span>
                  </div>
                  <div className="match-badge-group">
                    <span className={`match-level-badge ${activeCitation.match_level}`}>
                      {activeCitation.match_level === "strong"
                        ? t.strongMatch
                        : activeCitation.match_level === "weak"
                        ? t.weakMatch
                        : t.noMatch}
                    </span>
                    <span className="score-val">{(activeCitation.score * 100).toFixed(0)}%</span>
                  </div>
                </div>

                <div className="meta-row">
                  <span className="meta-label">{t.sectionLabel}</span>
                  <span className="meta-val">
                    {activeCitation.chapter} &rarr; {activeCitation.topic}
                  </span>
                </div>

                {/* PDF Page Image Viewer with Overlay */}
                <div className="pdf-viewer-card">
                  <div className="viewer-toolbar">
                    <div className="page-nav-btns">
                      <button
                        type="button"
                        className="tool-btn"
                        disabled={pageNumber <= 1}
                        onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                      >
                        {t.prevPage}
                      </button>
                      <span className="viewer-page-counter">
                        {pageNumber} / {totalBookPages}
                      </span>
                      <button
                        type="button"
                        className="tool-btn"
                        disabled={pageNumber >= totalBookPages}
                        onClick={() => setPageNumber((p) => Math.min(totalBookPages, p + 1))}
                      >
                        {t.nextPage}
                      </button>
                    </div>

                    <div className="zoom-controls">
                      <button
                        type="button"
                        className="tool-btn"
                        onClick={() => setZoomLevel((z) => Math.max(0.8, Number((z - 0.2).toFixed(1))))}
                      >
                        -
                      </button>
                      <span className="zoom-label">{Math.round(zoomLevel * 100)}%</span>
                      <button
                        type="button"
                        className="tool-btn"
                        onClick={() => setZoomLevel((z) => Math.min(2.0, Number((z + 0.2).toFixed(1))))}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="tool-btn"
                        onClick={() => setZoomLevel(1.0)}
                      >
                        {t.resetZoom}
                      </button>
                    </div>
                  </div>

                  <div className="page-canvas-wrapper" style={{ overflow: "auto" }}>
                    {pageImageError ? (
                      <div className="pdf-load-error">
                        <div className="pdf-load-error-title">Page {pageNumber} Preview Unavailable</div>
                        <p className="pdf-load-error-desc">
                          The backend server is either offline or starting up.
                        </p>
                        <button
                          type="button"
                          className="tool-btn retry-btn"
                          onClick={() => {
                            setPageImageError(false);
                            setPageImageLoading(true);
                          }}
                        >
                          Retry Loading
                        </button>
                      </div>
                    ) : (
                      <div
                        className="canvas-inner"
                        style={{
                          position: "relative",
                          display: "inline-block",
                          width: `${Math.round(zoomLevel * 100)}%`,
                          maxWidth: zoomLevel <= 1.0 ? "100%" : "none",
                          transition: "width 0.15s ease-out"
                        }}
                      >
                        {pageImageLoading && (
                          <div className="page-image-loading-indicator">
                            Rendering PDF Page {pageNumber}...
                          </div>
                        )}
                        <img
                          key={`${packId}-${pageNumber}`}
                          src={`${API}/page-image?pack_id=${packId}&page_number=${pageNumber}&dpi=150`}
                          alt={`PDF Page ${pageNumber}`}
                          className="rendered-pdf-page"
                          style={{ width: "100%", display: "block" }}
                          onLoad={() => {
                            setPageImageLoading(false);
                            setPageImageError(false);
                          }}
                          onError={() => {
                            setPageImageLoading(false);
                            setPageImageError(true);
                          }}
                        />

                        {activeCitation.page_number === pageNumber && activeCitation.bbox && (
                          <div
                            className="pdf-highlight-box"
                            style={{
                              position: "absolute",
                              left: `${(activeCitation.bbox[0] / 657) * 100}%`,
                              top: `${(activeCitation.bbox[1] / 848) * 100}%`,
                              width: `${((activeCitation.bbox[2] - activeCitation.bbox[0]) / 657) * 100}%`,
                              height: `${((activeCitation.bbox[3] - activeCitation.bbox[1]) / 848) * 100}%`
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Collapsible Raw Text Debug */}
                <div className="debug-toggle-panel">
                  <button
                    type="button"
                    className="debug-toggle-btn"
                    onClick={() => setShowRawDebug(!showRawDebug)}
                  >
                    <span>{showRawDebug ? "▼" : "▶"} {t.rawDebugBtn}</span>
                  </button>
                  {showRawDebug && (
                    <div className="raw-text-box">
                      <p className="debug-note">{t.rawDebugNote}</p>
                      <blockquote className="raw-snippet">{activeCitation.snippet}</blockquote>
                    </div>
                  )}
                </div>

                {/* Alternative Passages */}
                {activeMessage.citations.length > 1 && (
                  <div className="alternative-citations">
                    <span className="alt-title">{t.altPassagesTitle}</span>
                    <div className="alt-list">
                      {activeMessage.citations.map((c, i) => (
                        <button
                          key={i}
                          type="button"
                          className={`alt-card ${i === activeCiteIdx ? "active" : ""}`}
                          onClick={() => {
                            setActiveCiteIdx(i);
                            setPageNumber(c.page_number);
                          }}
                        >
                          <span className="alt-page">
                            p.{c.page_number} (Book p.{c.page_number + bookOffset})
                          </span>
                          <span className="alt-topic">{c.topic}</span>
                          <span className={`alt-badge ${c.match_level}`}>{c.match_level.toUpperCase()}</span>
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
