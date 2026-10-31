import { useEffect, useRef, useState } from "react";
import Tool from "./PagemarkTool.jsx";
import { translations } from "./locales.js";

const API = import.meta.env.DEV ? "http://localhost:8000" : "";

export function cleanHindiText(str) {
  if (!str) return "";
  let s = String(str).replace(/\u25CC/g, "");
  // Join isolated matras with their preceding consonant
  s = s.replace(/([\u0900-\u097F])\s+([\u093E-\u094F\u0962\u0963])/g, "$1$2");
  // Fix common broken ligature spaces in extracted physics terms
  s = s.replace(/गत\s+िकी/g, "गतिकी")
       .replace(/ऊ\s*ष्मा/g, "ऊष्मा")
       .replace(/ता\s*पी\s*य/g, "तापीय")
       .replace(/सा\s*म्य/g, "साम्य")
       .replace(/शून्य\s*वाँ/g, "शून्यवाँ")
       .replace(/प्र\s*थम/g, "प्रथम")
       .replace(/द्वि\s*तीय/g, "द्वितीय")
       .replace(/इंजन/g, "इंजन");
  return s.replace(/\s+/g, " ").trim();
}

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
  const [viewMode, setViewMode] = useState("scan"); // "scan" | "paper"
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
        <div className="answer-prose">{answerText}</div>
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
              title={`Page ${c.page_number} (${cleanHindiText(c.topic)})`}
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
      {/* Top Navigation Bar: Royal Blue Gradient Banner */}
      <header className="header-bar">
        <div className="brand-group">
          <div className="brand-badge-box">📖</div>
          <div className="brand-text-block">
            <span className="brand-title">{t.brandTitle}</span>
            <span className="brand-sub">{t.brandSub}</span>
          </div>
        </div>

        {/* Segmented Navigation Tabs in semi-transparent navy pill */}
        <nav className="nav-tabs-pill" aria-label="Mode Selection">
          <button
            type="button"
            className={`nav-tab-btn ${activeTab === "mentor" ? "active" : ""}`}
            onClick={() => setActiveTab("mentor")}
          >
            {t.tabQa}
          </button>
          <button
            type="button"
            className={`nav-tab-btn ${activeTab === "benchmark" ? "active" : ""}`}
            onClick={() => setActiveTab("benchmark")}
          >
            {t.tabBench}
          </button>
          <button
            type="button"
            className={`nav-tab-btn ${activeTab === "pagemark" ? "active" : ""}`}
            onClick={() => setActiveTab("pagemark")}
          >
            {t.tabPagemark}
          </button>
        </nav>

        {/* Status, Language, and Pack Controls */}
        <div className="header-meta">
          {/* Language Toggle Pill */}
          <div className="lang-switcher-pill">
            <button
              type="button"
              className={`lang-pill-btn ${lang === "en" ? "active" : ""}`}
              onClick={() => setLang("en")}
              title="Switch to English"
            >
              EN
            </button>
            <button
              type="button"
              className={`lang-pill-btn ${lang === "hi" ? "active" : ""}`}
              onClick={() => setLang("hi")}
              title="हिंदी में बदलें"
            >
              हिन्दी
            </button>
          </div>

          {/* Offline Ready Status Badge */}
          <div className="status-badge-pill">
            <span className={`status-dot ${isServerReady ? "live" : "standby"}`} />
            <span className="status-badge-text">
              {health === null
                ? t.serverOffline
                : isServerReady
                ? t.offlineReady
                : t.modelStandby}
            </span>
          </div>

          {/* Pack Selector & Upload PDF */}
          <div className="doc-controls-group">
            <select
              className="select-input-styled"
              value={packId}
              onChange={(e) => setPackId(e.target.value)}
              aria-label="Select Content Pack"
            >
              {packs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.chunks} {t.passages} · {p.total_pages || 20} {t.pages})
                </option>
              ))}
            </select>
            <label className="upload-pdf-btn">
              <span>{t.uploadPdf}</span>
              <input type="file" accept="application/pdf" onChange={handleFileUpload} hidden />
            </label>
          </div>
        </div>
      </header>

      {/* Sub-header Index Banner: Soft Sky-Blue Info Strip */}
      <div className="sub-header-strip">
        <div className="sub-header-content">
          <span className="sub-header-icon">📚</span>
          <span className="sub-header-text">
            <strong>Indexed {selectedPack?.chunks ?? 177} passages</strong> from {totalBookPages} pages &middot; NCERT Class 11 Physics Ch. 12 (ऊष्मागतिकी)
          </span>
        </div>
        {uploadStatus && <span className="upload-notice">{uploadStatus}</span>}
      </div>

      {/* Main Mode View */}
      {activeTab === "pagemark" ? (
        <main className="tool-container">
          <div className="tool-inner">
            <div className="section-header-banner">
              <span className="section-tag-indigo">{t.localToolTag}</span>
              <h2 className="section-title-clean">{t.localToolTitle}</h2>
            </div>
            <Tool />
          </div>
        </main>
      ) : activeTab === "benchmark" ? (
        <main className="benchmark-container">
          <div className="benchmark-inner">
            <div className="bench-header-row">
              <div>
                <span className="section-tag-indigo">{t.evalTag}</span>
                <h2 className="section-title-clean">{t.evalTitle}</h2>
                <p className="bench-desc">{t.evalDesc}</p>
              </div>
              <div className="bench-actions">
                <button
                  type="button"
                  className="primary-action-btn run-all-btn"
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
              <div className="bench-stats-row">
                <div className="stat-card emerald">
                  <span className="stat-card-label">{t.accuracyLabel}</span>
                  <span className="stat-card-value">{benchCorrect} / {benchEvaluated.length} CORRECT</span>
                </div>
                <div className="stat-card royal">
                  <span className="stat-card-label">{t.avgLatencyLabel}</span>
                  <span className="stat-card-value">{benchAvgLatency} SECONDS</span>
                </div>
              </div>
            )}

            <div className="bench-card-table">
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
          {/* Left Column: Student Q&A Dialogue & Benchmark Reference Chips */}
          <section className="dialogue-column" aria-label="Questions and Dialogue Stream">
            <div className="dialogue-scroll">
              {messages.length === 0 && (
                <div className="placeholder-state-card">
                  <div className="placeholder-icon">💡</div>
                  <h3 className="placeholder-heading">{t.noDialogueTitle}</h3>
                  <p className="placeholder-desc">{t.noDialogueDesc}</p>
                </div>
              )}

              {messages.map((m, idx) => {
                const msgUnavailable = isAnswerUnavailable(m.answer);
                return (
                  <div
                    key={idx}
                    className={`qa-card ${idx === activeMsgIdx ? "selected" : ""} ${
                      msgUnavailable ? "unavailable-card" : ""
                    }`}
                    onClick={() => {
                      setActiveMsgIdx(idx);
                      setActiveCiteIdx(0);
                    }}
                  >
                    {/* Card Header Strip: Soft Slate/Indigo */}
                    <div className="qa-card-header">
                      <span className="query-purple-badge">
                        {t.queryIndexPrefix} #{String(idx + 1).padStart(2, "0")}
                      </span>
                      {m.latency != null && (
                        <div className="qa-card-meta-badges">
                          <span className="latency-blue-badge">
                            ⏱ {(m.latency / 1000).toFixed(1)}s
                          </span>
                          <span className="page-amber-badge">
                            📄 PDF p.{m.citations[0]?.page_number ?? "-"}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Student Question */}
                    <h3 className="student-question-text">{m.question}</h3>
                    {m.error && <div className="error-box">{m.error}</div>}

                    {/* Failure state or Grounded Answer */}
                    {msgUnavailable ? (
                      <div className="unavailable-alert-box">
                        <div className="alert-head">
                          <span className="alert-icon">⚠️</span>
                          <span className="alert-title">{t.infoNotInBook}</span>
                        </div>
                        <p className="alert-body">{t.infoNotInBookDesc}</p>
                        <button
                          type="button"
                          className="closest-passages-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowFallbacks(true);
                          }}
                        >
                          {t.showClosestBtn}
                        </button>
                      </div>
                    ) : (
                      <div className="ai-answer-callout">
                        {renderAnswerWithCitations(m.answer, m.citations)}
                        {m.loading && <span className="cursor-pulse-dot" />}
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

            {/* Benchmark Reference Queries (Quick-Click Chips) */}
            {selectedPack?.sample_questions?.length > 0 && (
              <div className="benchmark-chips-section">
                <span className="chips-section-title">
                  ✨ {t.benchmarkQueriesTitle}
                </span>
                <div className="chips-flow-container">
                  {selectedPack.sample_questions.map((q, idx) => (
                    <button
                      key={idx}
                      className="benchmark-chip-btn"
                      disabled={isBusy}
                      onClick={() => handleAsk(q)}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Bottom Question Input Bar */}
            <div className="bottom-input-container">
              <div className="input-field-box">
                <textarea
                  className="query-textarea"
                  rows={2}
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder={t.inputPlaceholder}
                  aria-label="Input Query"
                />
                <div className="input-hints-bar">
                  <span>{t.inputHint}</span>
                </div>
              </div>
              <button
                className={`ask-question-btn ${inputVal.trim() ? "ready" : "disabled"}`}
                disabled={isBusy || !inputVal.trim()}
                onClick={() => handleAsk(inputVal)}
              >
                {isBusy ? t.processingBtn : `${t.submitBtn} →`}
              </button>
            </div>
          </section>

          {/* Right Column: Verified Textbook Source & Page Inspector */}
          <aside className="citation-column" aria-label="Source Document Citation">
            <div className="column-top-label">
              <span>📖 {t.retrievedFrom}</span>
            </div>

            {!activeCitation ? (
              <div className="citation-idle-card">
                <div className="idle-icon">🔍</div>
                <div className="idle-title">{t.awaitingQueryTitle}</div>
                <p className="idle-sub">{t.awaitingQueryDesc}</p>
              </div>
            ) : isUnavailable && !showFallbacks ? (
              <div className="citation-idle-card">
                <div className="idle-icon">📑</div>
                <div className="idle-title">{t.noMatchEvidenceTitle}</div>
                <p className="idle-sub">{t.noMatchEvidenceDesc}</p>
              </div>
            ) : (
              <div className="citation-details-wrapper">
                {activeCitation.section_warning && (
                  <div className="section-warning-card">
                    <span className="warning-icon">⚠️</span>
                    <span>{activeCitation.section_warning}</span>
                  </div>
                )}

                {/* Top Citation Verification Card with Gradient Accent Stripe */}
                <div className="verification-header-card">
                  <div className="verification-top-stripe" />
                  <div className="verification-content">
                    <div className="badges-row">
                      {/* Marigold Page Badge */}
                      <span className="badge-pill marigold">
                        PDF p.{pageNumber}
                      </span>
                      {/* Royal Blue Book Page Badge */}
                      <span className="badge-pill royal-blue">
                        Book p.{pageNumber + bookOffset}
                      </span>
                      {/* Emerald Match Badge */}
                      <span className={`badge-pill ${activeCitation.match_level === "strong" ? "emerald" : "amber"}`}>
                        {activeCitation.match_level === "strong"
                          ? t.strongMatch
                          : activeCitation.match_level === "weak"
                          ? t.weakMatch
                          : t.noMatch} &middot; {(activeCitation.score * 100).toFixed(0)}%
                      </span>
                    </div>

                    {/* Section Breadcrumb Pill (Fixed garbled Hindi text) */}
                    <div className="section-breadcrumb-pill">
                      <span className="breadcrumb-label">{t.sectionLabel}</span>
                      <span className="breadcrumb-val">
                        {cleanHindiText(activeCitation.chapter || "ऊष्मागतिकी")} &rarr; {cleanHindiText(activeCitation.topic)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* PDF Page Viewer & Fallback Textbook Paper View */}
                <div className="pdf-viewer-card">
                  {/* Viewer Toolbar */}
                  <div className="viewer-toolbar">
                    <div className="page-nav-btns">
                      <button
                        type="button"
                        className="viewer-nav-btn"
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
                        className="viewer-nav-btn"
                        disabled={pageNumber >= totalBookPages}
                        onClick={() => setPageNumber((p) => Math.min(totalBookPages, p + 1))}
                      >
                        {t.nextPage}
                      </button>
                    </div>

                    {/* View Mode Toggle: Scan vs Textbook Excerpt */}
                    <div className="view-mode-toggle">
                      <button
                        type="button"
                        className={`view-mode-btn ${viewMode === "scan" && !pageImageError ? "active" : ""}`}
                        onClick={() => setViewMode("scan")}
                      >
                        {t.viewScan}
                      </button>
                      <button
                        type="button"
                        className={`view-mode-btn ${viewMode === "paper" || pageImageError ? "active" : ""}`}
                        onClick={() => setViewMode("paper")}
                      >
                        {t.viewExcerpt}
                      </button>
                    </div>

                    {/* Zoom controls */}
                    <div className="zoom-controls">
                      <button
                        type="button"
                        className="zoom-btn"
                        onClick={() => setZoomLevel((z) => Math.max(0.8, Number((z - 0.2).toFixed(1))))}
                      >
                        -
                      </button>
                      <span className="zoom-label">{Math.round(zoomLevel * 100)}%</span>
                      <button
                        type="button"
                        className="zoom-btn"
                        onClick={() => setZoomLevel((z) => Math.min(2.0, Number((z + 0.2).toFixed(1))))}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        className="zoom-btn reset-btn"
                        onClick={() => setZoomLevel(1.0)}
                      >
                        {t.resetZoom}
                      </button>
                    </div>
                  </div>

                  {/* Surface: Either Scanned PDF or Warm Cream Textbook Paper */}
                  {viewMode === "scan" && !pageImageError ? (
                    <div className="page-canvas-wrapper" style={{ overflow: "auto" }}>
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
                            setViewMode("paper");
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
                    </div>
                  ) : (
                    /* Warm Cream Textbook Paper Surface (Paper view or Fallback) */
                    <div className="textbook-paper-surface">
                      <div className="textbook-spine-line" />
                      <div className="textbook-paper-header">
                        <div className="paper-badge-pill">
                          📖 {t.textbookExcerptTitle}
                        </div>
                        <div className="paper-page-indicator">
                          PDF p.{pageNumber} &middot; Book p.{pageNumber + bookOffset}
                        </div>
                      </div>

                      <div className="textbook-paper-body">
                        <div className="paper-section-title">
                          § {cleanHindiText(activeCitation.topic)}
                        </div>
                        <div className="paper-passage-content">
                          {activeCitation.snippet}
                        </div>
                      </div>

                      <div className="textbook-paper-footer">
                        <span>{t.textbookExcerptFooter}</span>
                        <span>Page {pageNumber + bookOffset}</span>
                      </div>
                    </div>
                  )}
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

                {/* Alternative Passages Considered */}
                {activeMessage.citations.length > 1 && (
                  <div className="alternative-citations-section">
                    <span className="alt-section-title">{t.altPassagesTitle}</span>
                    <div className="alt-cards-stack">
                      {activeMessage.citations.map((c, i) => (
                        <button
                          key={i}
                          type="button"
                          className={`alt-passage-card ${i === activeCiteIdx ? "active" : ""}`}
                          onClick={() => {
                            setActiveCiteIdx(i);
                            setPageNumber(c.page_number);
                          }}
                        >
                          <span className="alt-page-marigold">
                            p.{c.page_number}
                          </span>
                          <span className="alt-topic-text">{cleanHindiText(c.topic)}</span>
                          <span className={`alt-match-emerald ${c.match_level}`}>
                            {c.match_level.toUpperCase()}
                          </span>
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
