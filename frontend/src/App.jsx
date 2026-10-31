import { useEffect, useRef, useState } from "react";
import Tool from "./PagemarkTool.jsx";
import { SUPPORTED_LANGUAGES, translations } from "./locales.js";

const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "" : "http://127.0.0.1:8000");

export async function safeFetch(path, options) {
  try {
    const res = await fetch(`${API_BASE}${path}`, options);
    if (!res.ok && res.status !== 400 && res.status !== 422) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res;
  } catch (err) {
    if (API_BASE !== "http://127.0.0.1:8000" && !(options?.body instanceof FormData)) {
      return await fetch(`http://127.0.0.1:8000${path}`, options);
    }
    throw err;
  }
}

/**
 * Repairs broken NCERT legacy PDF Devanagari ligatures, dotted circles (◌),
 * replacement boxes (□), and raw LaTeX math delimiters.
 */
const NCERT_LIGATURE_FIXES = [
  [/^\s*ि\s*ट\s+ऊ[\u25CC\uFFFD]*मा/g, "विशिष्ट ऊष्मा"],
  [/विशि\s*ट/g, "विशिष्ट"],
  [/ऊ[\u25CC\uFFFD\s]*मागत\s*ि?\s*की/g, "ऊष्मागतिकी"],
  [/ऊ[\u25CC\uFFFD]*मा/g, "ऊष्मा"],
  [/मा[\u25CC\uFFFD]*ा?क/g, "मात्रक"],
  [/भ्रू?प\s+में/g, "रूप में"],
  [/जोजल/g, "जो जल"],
  [/वृं?[\u25CC\uFFFD]+ि/g, "वृद्धि"],
  [/अध\s+कि/g, "अधिक"],
  [/परिशुं?[\u25CC\uFFFD]+/g, "परिशुद्ध"],
  [/किं\s*च\s*तिमा[\u25CC\uFFFD]*ा?/g, "किंचित्मात्र"],
  [/परिवं?[\u25CC\uFFFD]*तन/g, "परिवर्तन"],
  [/चि[\u25CC\uFFFD]*्रू?-/g, "चित्र "],
  [/दश[\u25CC\uFFFD]*ा?या/g, "दर्शाया"],
  [/का\s*[\u25CC\uFFFD]*थि\s*र/g, "का स्थिर"],
  [/अधोलि\s*ख\s*तिको/g, "अधोलिखित को"],
  [/चि\s*-\s*आदं?[\u25CC\uFFFD]*श/g, "चित्र - आदर्श"],
  [/आदं?[\u25CC\uFFFD]*श/g, "आदर्श"],
  [/र्?ुं?[\u25CC\uFFFD]*ो[\u25CC\uFFFD]*म/g, "रुद्धोष्म"],
  [/प[\u25CC\uFFFD]*्रू?[\u25CC\uFFFD]*मों/g, "प्रक्रमों"],
  [/व[\u25CC\uFFFD]*्र/g, "वक्र"],
  // Clean trailing garbled formula OCR sequence in Page 6 excerpt
  [/=\s*≡\s*[\uFFFD\u25A1\s]+.*?(?=यहाँ)/g, " "],
];

export function formatMathText(input) {
  if (!input || typeof input !== "string") return "";
  return input
    .replace(/\\\(|\\\)|\\\[|\\\]/g, "")
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/\\Delta/g, "Δ")
    .replace(/\\therefore/g, "∴")
    .replace(/\\because/g, "∵")
    .replace(/\\equiv/g, "≡");
}

export function normalizeDevanagari(input) {
  if (!input || typeof input !== "string") return "";

  let text = String(input);

  // 1. Apply targeted NCERT Hindi ligature reconstructions
  for (const [pattern, replacement] of NCERT_LIGATURE_FIXES) {
    text = text.replace(pattern, replacement);
  }

  // 2. Fix visual-order short 'i' matra (ि \u093F) before a consonant
  text = text.replace(/\u25CC\u093F\s*([\u0915-\u0939\u0958-\u095F])/g, "$1\u093F");

  // 3. Remove dotted circles (◌), replacement chars ( / □), and PUA glyphs
  text = text.replace(/[\u25CC\uFFFD\u25A1\uF000-\uF8FF\u200B\uFEFF]/g, "");

  // 4. Collapse stray spaces before Devanagari matras, halant, anusvara, visarga
  text = text.replace(
    /([\u0905-\u0939\u0958-\u095F\u093E-\u094C])\s+([\u0901-\u0903\u093A-\u094F\u0951-\u0957\u0962\u0963])/g,
    "$1$2"
  );
  text = text.replace(/(\u094D)\s+([\u0915-\u0939\u0958-\u095F])/g, "$1$2");

  // 5. Clean raw LaTeX delimiters and math operators
  text = formatMathText(text);

  // 6. Collapse duplicate whitespace and normalize to NFC
  return text.replace(/[ \t]{2,}/g, " ").normalize("NFC").trim();
}

export function hasBrokenUnicodeArtifacts(input) {
  if (!input || typeof input !== "string") return false;
  return normalizeDevanagari(input) !== input.trim();
}

// Alias for backwards compatibility
export const cleanHindiText = normalizeDevanagari;

export default function App() {
  const [lang, setLang] = useState("en");
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
  const [isUploading, setIsUploading] = useState(false);

  // Voice Speech-to-Text & Text-to-Speech state
  const [micLang, setMicLang] = useState("hi-IN"); // "hi-IN" | "en-IN"
  const [isRecording, setIsRecording] = useState(false);
  const [micError, setMicError] = useState("");
  const [speakingIdx, setSpeakingIdx] = useState(null);
  const [unicodeRepaired, setUnicodeRepaired] = useState(false);
  const recognitionRef = useRef(null);

  // Right Column Editorial / PDF Page viewer state
  const [pageNumber, setPageNumber] = useState(1);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [highlightSource, setHighlightSource] = useState(true);
  const [pageImageLoading, setPageImageLoading] = useState(false);
  const [pageImageError, setPageImageError] = useState(false);
  const [imgAttempt, setImgAttempt] = useState(0);
  const [imgSrc, setImgSrc] = useState("");
  const [showRawDebug, setShowRawDebug] = useState(false);
  const [showFallbacks, setShowFallbacks] = useState(false);

  // Benchmarks state
  const [benchmarks, setBenchmarks] = useState([]);
  const [benchResults, setBenchResults] = useState({});
  const [isRunningAll, setIsRunningAll] = useState(false);
  const [benchProgress, setBenchProgress] = useState({ current: 0, total: 0 });

  const logBottomRef = useRef(null);

  const getPrimaryImageUrl = (pId, pNum) => {
    return `${API_BASE}/page-image?pack_id=${encodeURIComponent(pId)}&page_number=${pNum}&dpi=150`;
  };

  const getFallbackImageUrl = (pId, pNum) => {
    return `http://127.0.0.1:8000/page-image?pack_id=${encodeURIComponent(pId)}&page_number=${pNum}&dpi=150`;
  };

  const fetchPacks = () => {
    return safeFetch("/packs")
      .then((res) => res.json())
      .then((data) => {
        setPacks(data);
        if (data.length && !data.find((p) => p.id === packId)) {
          setPackId(data[0].id);
        }
        return data;
      })
      .catch(() => []);
  };

  const fetchBenchmarks = () => {
    safeFetch("/benchmarks")
      .then((res) => res.json())
      .then((data) => setBenchmarks(data))
      .catch(() => {});
  };

  useEffect(() => {
    const checkHealth = () => {
      safeFetch("/health")
        .then((res) => res.json())
        .then((data) => setHealth(data))
        .catch(() => setHealth(null));
    };
    checkHealth();
    fetchPacks();
    fetchBenchmarks();
    const interval = setInterval(checkHealth, 5000);
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
    setImgAttempt(0);
    setImgSrc(getPrimaryImageUrl(packId, pageNumber));
    setPageImageError(false);
    setPageImageLoading(true);
  }, [packId, pageNumber]);

  useEffect(() => {
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const updateMessage = (index, updater) => {
    setMessages((prev) => prev.map((msg, i) => (i === index ? updater(msg) : msg)));
  };

  const isAnswerUnavailable = (text) => {
    if (!text) return false;
    const lower = text.toLowerCase();
    const markers = [
      "not available", "not found", "उपलब्ध नहीं", "नहीं मिला", "जानकारी नहीं",
      "no disponible", "no se encuentra", "non disponible", "introuvable",
      "nicht verfügbar", "nicht gefunden", "তথ্য পাওয়া যায়নি", "माहिती उपलब्ध नाही",
      "தகவல் கிடைக்கவில்லை", "సమాచారం అందుబాటులో లేదు", "માહિતી ઉપલબ્ધ નથી",
      "ಮಾಹಿತಿ ಲಭ್ಯವಿಲ್ಲ", "വിവരങ്ങൾ ലഭ്യമല്ല", "ਜਾਣਕਾਰੀ ਉਪਲਬਧ ਨਹੀਂ", "معلومات دستیاب نہیں",
      "المعلومات غير متوفرة", "情報がありません", "文档中无此信息", "информация не найдена"
    ];
    return markers.some((m) => lower.includes(m));
  };

  // Speech-to-Text handler
  const startRecording = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMicError("Speech recognition not supported");
      setTimeout(() => setMicError(""), 3500);
      return;
    }
    setMicError("");
    try {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = micLang;

      recognition.onstart = () => {
        setIsRecording(true);
      };

      recognition.onresult = (event) => {
        let transcript = "";
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript) {
          const cleaned = normalizeDevanagari(transcript);
          setInputVal(cleaned);
        }
      };

      recognition.onerror = (event) => {
        if (event.error !== "no-speech") {
          setMicError(`Mic: ${event.error}`);
          setTimeout(() => setMicError(""), 3500);
        }
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognition.start();
    } catch (err) {
      setMicError("Microphone access denied");
      setIsRecording(false);
      setTimeout(() => setMicError(""), 3500);
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    setIsRecording(false);
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  // Text-to-Speech audio readout
  const handleToggleSpeech = (idx, text) => {
    if (!window.speechSynthesis) return;
    if (speakingIdx === idx) {
      window.speechSynthesis.cancel();
      setSpeakingIdx(null);
      return;
    }
    window.speechSynthesis.cancel();
    const cleaned = normalizeDevanagari(text);
    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.lang = "hi-IN";
    utterance.rate = 0.95;
    utterance.onend = () => setSpeakingIdx(null);
    utterance.onerror = () => setSpeakingIdx(null);
    setSpeakingIdx(idx);
    window.speechSynthesis.speak(utterance);
  };

  // Auto-normalize input on change and detect repairs
  const handleInputChange = (e) => {
    const raw = e.target.value;
    const normalized = normalizeDevanagari(raw);
    if (raw && raw !== normalized && /[\u0900-\u097F]/.test(raw)) {
      setUnicodeRepaired(true);
      setInputVal(normalized);
      setTimeout(() => setUnicodeRepaired(false), 3000);
    } else {
      setInputVal(raw);
    }
  };

  async function handleAsk(questionText) {
    const rawQ = questionText.trim();
    if (!rawQ || isBusy) return;

    if (isRecording) {
      stopRecording();
    }

    const q = normalizeDevanagari(rawQ);
    const currentMsgIndex = messages.length;
    setInputVal("");
    setIsBusy(true);
    setSearchStep(t.stepSearching || "Searching indexed passages...");
    setActiveMsgIdx(currentMsgIndex);
    setActiveCiteIdx(0);
    setShowFallbacks(false);

    setMessages((prev) => [
      ...prev,
      { question: q, answer: "", citations: [], loading: true, latency: null, error: null }
    ]);

    try {
      const response = await safeFetch("/ask/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack_id: packId, question: q, language: lang })
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server error: ${response.status}`);
      }

      setSearchStep(t.stepReading || "Analyzing context...");

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
            setSearchStep(t.stepAnswering || "Synthesizing answer...");
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
        const res = await safeFetch("/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pack_id: packId, question: item.question, language: lang })
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

    setIsUploading(true);
    setUploadStatus("Uploading & indexing document (parsing passages)...");
    const formData = new FormData();
    formData.append("file", file);

    try {
      const uploadUrl = API_BASE ? `${API_BASE}/ingest` : "http://127.0.0.1:8000/ingest";
      let res;
      try {
        res = await fetch(uploadUrl, { method: "POST", body: formData });
      } catch (networkErr) {
        // Fallback with fresh FormData if direct call had network issue
        const fallbackForm = new FormData();
        fallbackForm.append("file", file);
        res = await fetch("/ingest", { method: "POST", body: fallbackForm });
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || `Server error: ${res.status}`);
      }

      const data = await res.json();
      setUploadStatus(`Indexed ${data.chunks} passages (${data.pages_parsed || 1} pages)`);
      await fetchPacks();
      if (data.pack_id) {
        setPackId(data.pack_id);
      }
      setPageNumber(1);
      setActiveMsgIdx(-1);
      setMessages([]);
    } catch (err) {
      setUploadStatus(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
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
  const bookOffset = selectedPack?.book_page_offset ?? 0;
  const totalBookPages = selectedPack?.total_pages || 20;

  const activeMessage = messages[activeMsgIdx];
  const activeCitation = activeMessage?.citations?.[activeCiteIdx];
  const isServerReady = health && health.ollama_ready;
  const isUnavailable = activeMessage && isAnswerUnavailable(activeMessage.answer);

  const benchEvaluated = Object.values(benchResults);
  const benchCorrect = benchEvaluated.filter((b) => b.pass).length;
  const benchAvgLatency = benchEvaluated.length
    ? Math.round(benchEvaluated.reduce((acc, curr) => acc + (curr.latency || 0), 0) / benchEvaluated.length / 1000)
    : 0;

  const defaultQuestions = [
    `Summarize the key concepts in ${selectedPack?.title || "this chapter"}.`,
    "What are the main topics discussed?",
    "Explain the first section in detail."
  ];
  const displayedSampleQuestions = selectedPack?.sample_questions?.length
    ? selectedPack.sample_questions
    : defaultQuestions;

  const renderAnswerWithCitations = (answerText, citations = []) => {
    const formatted = formatMathText(normalizeDevanagari(answerText));
    if (!citations.length) return <div className="answer-prose-text">{formatted}</div>;
    return (
      <div className="bento-answer-prose">
        <div className="answer-prose-text">{formatted}</div>
        <div className="bento-sources-row">
          <span className="sources-label-tag">{t.sourcesTitle}</span>
          {citations.map((c, i) => {
            const isSelected = i === activeCiteIdx;
            return (
              <button
                key={i}
                type="button"
                className={`source-citation-pill ${isSelected ? "active" : ""}`}
                onClick={() => {
                  setActiveCiteIdx(i);
                  setPageNumber(c.page_number);
                }}
                title={`Page ${c.page_number} (${normalizeDevanagari(c.topic)})`}
              >
                <span>[{i + 1}] PDF p.{c.page_number} {bookOffset > 0 ? `· Book p.${c.page_number + bookOffset}` : ""}</span>
                <span className="pill-arrow-icon">{isSelected ? "↗" : "→"}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="bento-app-canvas">
      {/* ============================================================== */}
      {/* FLOATING WHITE PILL TOP NAVIGATION BAR (Height: 60px)         */}
      {/* ============================================================== */}
      <header className="bento-floating-header">
        <div className="nav-brand-cluster">
          <div className="brand-charcoal-square">
            <span className="square-dot" />
          </div>
          <div className="brand-title-wrap">
            <span className="brand-primary-name">{t.brandTitle}</span>
            <span className="brand-sub-badge">Offline Bento AI</span>
          </div>
        </div>

        {/* Minimalist Dot-Prefixed Pill Tabs */}
        <nav className="bento-nav-pill-tabs" aria-label="Mode Navigation">
          <button
            type="button"
            className={`bento-nav-tab ${activeTab === "mentor" ? "active" : ""}`}
            onClick={() => setActiveTab("mentor")}
          >
            <span className="tab-bullet">•</span>
            <span>{t.tabQa}</span>
          </button>
          <button
            type="button"
            className={`bento-nav-tab ${activeTab === "benchmark" ? "active" : ""}`}
            onClick={() => setActiveTab("benchmark")}
          >
            <span className="tab-bullet">•</span>
            <span>{t.tabBench}</span>
          </button>
          <button
            type="button"
            className={`bento-nav-tab ${activeTab === "pagemark" ? "active" : ""}`}
            onClick={() => setActiveTab("pagemark")}
          >
            <span className="tab-bullet">•</span>
            <span>{t.tabPagemark}</span>
          </button>
        </nav>

        {/* Header Right Controls */}
        <div className="nav-right-cluster">
          {/* Multilingual Selector */}
          <div className="bento-lang-wrapper">
            <select
              className="bento-lang-dropdown"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              aria-label="Select Interface Language"
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>

          {/* Status Pill with Pulsing Dot */}
          <div className={`bento-status-pill ${isServerReady ? "online" : health ? "standby" : "disconnected"}`}>
            <span className={`pulsing-status-dot ${isServerReady ? "online" : health ? "standby" : "disconnected"}`} />
            <span className="status-pill-text">
              {health === null ? t.serverOffline : isServerReady ? t.offlineReady : t.modelStandby}
            </span>
          </div>
        </div>
      </header>

      {/* ============================================================== */}
      {/* 2-COLUMN FLOATING BENTO WORKSPACE (LEFT & RIGHT ROUNDED CARDS)  */}
      {/* ============================================================== */}
      <div className="bento-split-workspace">
        {/* ============================================================ */}
        {/* LEFT BENTO CARD (Study, Dialogue & Prompt Workspace)         */}
        {/* ============================================================ */}
        <section className="bento-card bento-card-left" aria-label="Study & QA Workspace">
          {/* Document & Chapter Header Block */}
          <div className="bento-chapter-header">
            <div className="chapter-control-row">
              <div className="pack-select-wrapper">
                <select
                  className="bento-pack-select"
                  value={packId}
                  onChange={(e) => {
                    setPackId(e.target.value);
                    setPageNumber(1);
                    setActiveMsgIdx(-1);
                  }}
                  aria-label="Select Content Pack"
                >
                  {packs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.chunks} {t.passages} · {p.total_pages || 1} {t.pages})
                    </option>
                  ))}
                </select>
              </div>

              <label className="bento-upload-btn">
                <span>{isUploading ? "INDEXING..." : t.uploadPdf}</span>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                  hidden
                />
              </label>
            </div>

            <div className="chapter-headline-row">
              <h1 className="chapter-title-main">
                {normalizeDevanagari(selectedPack?.title || "NCERT Document")}
              </h1>
              <div className="chapter-meta-badges">
                <span className="bento-meta-badge">{selectedPack?.chunks ?? 0} {t.passages}</span>
                <span className="bento-meta-badge">{totalBookPages} {t.pages}</span>
              </div>
            </div>

            {uploadStatus && <div className="bento-upload-banner">{uploadStatus}</div>}
          </div>

          {/* Middle QA Stream / Benchmarks / Search Mode */}
          {activeTab === "benchmark" ? (
            <div className="bento-bench-left-pane">
              <div className="bench-header-action">
                <button
                  type="button"
                  className="btn-lime-pill bench-start-btn"
                  disabled={isRunningAll}
                  onClick={runAllBenchmarks}
                >
                  <span>
                    {isRunningAll
                      ? `${t.runningBtn} (${benchProgress.current}/${benchProgress.total})`
                      : t.runAllBtn}
                  </span>
                  <span>↗</span>
                </button>
              </div>

              {benchEvaluated.length > 0 && (
                <div className="bento-bench-metrics-row">
                  <div className="bento-metric-tile">
                    <span className="metric-tile-label">{t.accuracyLabel}</span>
                    <span className="metric-tile-val green">
                      {benchCorrect} / {benchEvaluated.length} ({Math.round((benchCorrect / benchEvaluated.length) * 100)}%)
                    </span>
                  </div>
                  <div className="bento-metric-tile">
                    <span className="metric-tile-label">{t.avgLatencyLabel}</span>
                    <span className="metric-tile-val">{benchAvgLatency}s</span>
                  </div>
                </div>
              )}

              <div className="bento-bench-items-scroll">
                {benchmarks.map((item, i) => {
                  const res = benchResults[item.question];
                  return (
                    <div key={i} className="bento-bench-item-card">
                      <div className="bench-item-meta-row">
                        <span className="bench-item-q-badge">Q{String(i + 1).padStart(2, "0")}</span>
                        <span className="bench-item-target">Target p.{item.expected_page}</span>
                        {res && (
                          <span className={`bench-item-status ${res.pass ? "pass" : "fail"}`}>
                            {res.pass ? t.statusPass : `${t.statusFail} (got p.${res.got ?? "-"})`}
                          </span>
                        )}
                      </div>
                      <div className="bench-item-question">{normalizeDevanagari(item.question)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : activeTab === "pagemark" ? (
            <div className="bento-pagemark-intro">
              <span className="bento-badge-violet">{t.localToolTag}</span>
              <h3 className="bento-intro-title">{t.localToolTitle}</h3>
              <p className="bento-intro-desc">
                Direct in-browser keyword discovery and page scanning. Drop any PDF to immediately index and extract passages without sending data off-device.
              </p>
            </div>
          ) : (
            /* Dialogue Stream */
            <div className="bento-qa-stream">
              {messages.length === 0 && (
                <div className="bento-empty-state">
                  <span className="bento-badge-violet">[AWAITING QUERY]</span>
                  <h3 className="empty-heading">{t.noDialogueTitle}</h3>
                  <p className="empty-subtext">{t.noDialogueDesc}</p>
                </div>
              )}

              {messages.map((m, idx) => {
                const msgUnavailable = isAnswerUnavailable(m.answer);
                const isSelected = idx === activeMsgIdx;
                return (
                  <article
                    key={idx}
                    className={`bento-qa-card ${isSelected ? "selected" : ""} ${msgUnavailable ? "unavailable" : ""}`}
                    onClick={() => {
                      setActiveMsgIdx(idx);
                      setActiveCiteIdx(0);
                    }}
                  >
                    <header className="bento-card-header">
                      <div className="card-meta-cluster">
                        <span className="query-index-badge">
                          {t.queryIndexPrefix} #{String(idx + 1).padStart(2, "0")}
                        </span>
                        {m.latency != null && (
                          <span className="latency-bento-badge">
                            {(m.latency / 1000).toFixed(1)}s
                          </span>
                        )}
                        {m.citations?.[0]?.page_number && (
                          <span className="page-bento-badge">
                            PDF p.{m.citations[0].page_number}
                          </span>
                        )}
                      </div>

                      {/* Text-to-Speech Audio Readout Pill */}
                      {m.answer && !m.loading && (
                        <button
                          type="button"
                          className={`bento-audio-pill ${speakingIdx === idx ? "active" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSpeech(idx, m.answer);
                          }}
                          title="Read answer aloud"
                        >
                          {speakingIdx === idx ? (
                            <>
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                                <rect x="4" y="4" width="16" height="16" rx="2"/>
                              </svg>
                              <span>STOP</span>
                            </>
                          ) : (
                            <>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                              </svg>
                              <span>LISTEN</span>
                            </>
                          )}
                        </button>
                      )}
                    </header>

                    <h2 className="qa-card-question">{normalizeDevanagari(m.question)}</h2>
                    {m.error && <div className="qa-card-error">{m.error}</div>}

                    {msgUnavailable ? (
                      <div className="qa-unavailable-card">
                        <div className="unavailable-card-title">[!] {t.infoNotInBook}</div>
                        <p className="unavailable-card-desc">{t.infoNotInBookDesc}</p>
                        <button
                          type="button"
                          className="btn-show-closest"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowFallbacks(true);
                          }}
                        >
                          {t.showClosestBtn} ↗
                        </button>
                      </div>
                    ) : (
                      <div className="qa-answer-block">
                        {renderAnswerWithCitations(m.answer, m.citations)}
                        {m.loading && <span className="bento-cursor-pulse" />}
                      </div>
                    )}
                  </article>
                );
              })}

              {isBusy && searchStep && (
                <div className="bento-search-indicator">
                  <span className="search-lime-dot" />
                  <span className="search-step-text">{searchStep}</span>
                </div>
              )}

              <div ref={logBottomRef} />
            </div>
          )}

          {/* Bottom Prompt & Suggestions Container */}
          {activeTab === "mentor" && (
            <div className="bento-bottom-section">
              {/* Clean Flex-Wrap Suggested Query Chips */}
              {displayedSampleQuestions.length > 0 && (
                <div className="bento-suggested-queries-wrap">
                  <span className="suggested-queries-label">{t.benchmarkQueriesTitle}</span>
                  <div className="suggested-chips-container">
                    {displayedSampleQuestions.slice(0, 3).map((q, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="bento-suggested-chip"
                        disabled={isBusy}
                        onClick={() => handleAsk(q)}
                      >
                        <span>{normalizeDevanagari(q)}</span>
                        <span className="chip-arrow">↗</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Deep Ink Charcoal Contrast Prompt Dock */}
              <div className="ink-dark-dock">
                <div className="dock-textarea-wrapper">
                  <textarea
                    className="dock-input-textarea"
                    rows={2}
                    value={inputVal}
                    onChange={handleInputChange}
                    onKeyDown={handleInputKeyDown}
                    placeholder={t.inputPlaceholder}
                    aria-label="Ask a question"
                  />
                  {unicodeRepaired && (
                    <span className="dock-repair-badge">UNICODE NFC REPAIRED</span>
                  )}
                  {micError && (
                    <span className="dock-mic-error">{micError}</span>
                  )}
                </div>

                <div className="dock-controls-row">
                  <span className="dock-kbd-hint">{t.inputHint}</span>

                  <div className="dock-actions-cluster">
                    {/* Pill-shaped हिं | EN toggle */}
                    <div className="dock-mic-lang-toggle">
                      <button
                        type="button"
                        className={`lang-sub-btn ${micLang === "hi-IN" ? "active" : ""}`}
                        onClick={() => setMicLang("hi-IN")}
                        title="Hindi Voice"
                      >
                        हिं
                      </button>
                      <button
                        type="button"
                        className={`lang-sub-btn ${micLang === "en-IN" ? "active" : ""}`}
                        onClick={() => setMicLang("en-IN")}
                        title="English Voice"
                      >
                        EN
                      </button>
                    </div>

                    {/* Glowing Violet/Red Mic Button */}
                    <button
                      type="button"
                      className={`dock-mic-btn ${isRecording ? "recording" : ""}`}
                      onClick={toggleRecording}
                      title={isRecording ? "Stop recording" : "Voice input"}
                      aria-label="Voice input microphone"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                        <line x1="12" y1="19" x2="12" y2="23"/>
                        <line x1="8" y1="23" x2="16" y2="23"/>
                      </svg>
                    </button>

                    {/* Signature Electric Lime Pill Submit Button */}
                    <button
                      type="button"
                      className="btn-lime-pill dock-submit-btn"
                      disabled={isBusy || !inputVal.trim()}
                      onClick={() => handleAsk(inputVal)}
                    >
                      <span>{isBusy ? t.processingBtn || "PROCESSING..." : t.submitBtn}</span>
                      <span>↗</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ============================================================ */}
        {/* RIGHT BENTO CARD (Verified Source & PDF Scan Reader)         */}
        {/* ============================================================ */}
        <section className="bento-card bento-card-right" aria-label="Verified Source & PDF Scan Reader">
          {activeTab === "pagemark" ? (
            <div className="bento-pagemark-container">
              <Tool />
            </div>
          ) : activeTab === "benchmark" ? (
            /* Benchmarks Full Evaluation Table */
            <div className="bento-bench-evaluation-canvas">
              <div className="bento-toolbar-header">
                <span className="bento-toolbar-title">{t.evalTitle}</span>
                <span className="bento-toolbar-count">{benchmarks.length} TEST QUERIES</span>
              </div>

              <div className="bento-bench-table-scroll">
                <h2 className="eval-headline">{t.evalTitle}</h2>
                <p className="eval-subtext">{t.evalDesc}</p>

                <div className="bento-eval-table">
                  <div className="bento-table-thead">
                    <span className="col-q">{t.colQuery}</span>
                    <span className="col-target">{t.colExpPage}</span>
                    <span className="col-retrieved">{t.colGotPage}</span>
                    <span className="col-status">{t.colStatus}</span>
                    <span className="col-latency">{t.colLatency}</span>
                  </div>
                  {benchmarks.map((item, i) => {
                    const res = benchResults[item.question];
                    return (
                      <div key={i} className="bento-table-trow">
                        <div className="col-q">
                          <strong>Q{i + 1}:</strong> {normalizeDevanagari(item.question)}
                        </div>
                        <div className="col-target">
                          PDF p.{item.expected_page} {bookOffset > 0 ? `(Book p.${item.expected_page + bookOffset})` : ""}
                        </div>
                        <div className="col-retrieved">
                          {res ? (res.got ? `PDF p.${res.got}` : "None") : "—"}
                        </div>
                        <div className="col-status">
                          {!res ? (
                            <span className="eval-status-chip pending">{t.statusPending}</span>
                          ) : res.pass ? (
                            <span className="eval-status-chip pass">{t.statusPass}</span>
                          ) : (
                            <span className="eval-status-chip fail">{t.statusFail}</span>
                          )}
                        </div>
                        <div className="col-latency">
                          {res?.latency != null ? `${(res.latency / 1000).toFixed(1)}s` : "—"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            /* Textbook Document & Highlight Viewer */
            <div className="bento-document-flow">
              {/* Top Source Verification Toolbar */}
              <div className="bento-toolbar-header">
                <div className="toolbar-left-cluster">
                  <button
                    type="button"
                    className={`bento-toggle-switch ${highlightSource ? "active" : ""}`}
                    onClick={() => setHighlightSource(!highlightSource)}
                    title="Toggle highlight"
                  >
                    <span className="toggle-switch-thumb" />
                  </button>
                  <span className="toggle-switch-caption">{t.highlightToggle}</span>

                  {activeCitation && (
                    <span className="bento-badge-lime">
                      {activeCitation.match_level === "strong" ? "STRONG MATCH" : "MATCH"} {(activeCitation.score * 100).toFixed(0)}%
                    </span>
                  )}

                  <span className="bento-badge-violet" title="Unicode NFC Normalized">
                    UNICODE NFC CLEANED
                  </span>
                </div>

                <div className="toolbar-right-cluster">
                  <span className="pagination-label-mono">
                    {String(pageNumber).padStart(2, "0")} / {String(totalBookPages).padStart(2, "0")}
                  </span>
                  <button
                    type="button"
                    className="bento-step-arrow-btn"
                    disabled={pageNumber <= 1}
                    onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                    title="Previous page"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="15 18 9 12 15 6"/>
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="bento-step-arrow-btn"
                    disabled={pageNumber >= totalBookPages}
                    onClick={() => setPageNumber((p) => Math.min(totalBookPages, p + 1))}
                    title="Next page"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* Reader Body: Awaiting vs PDF Page Scan */}
              {!activeCitation ? (
                <div className="bento-reader-awaiting">
                  <span className="bento-badge-violet">[TEXTBOOK READY]</span>
                  <h3 className="awaiting-title">{t.awaitingQueryTitle}</h3>
                  <p className="awaiting-description">{t.awaitingQueryDesc}</p>
                </div>
              ) : isUnavailable && !showFallbacks ? (
                <div className="bento-reader-awaiting">
                  <span className="bento-badge-violet">[NO DIRECT MATCH]</span>
                  <h3 className="awaiting-title">{t.noMatchEvidenceTitle}</h3>
                  <p className="awaiting-description">{t.noMatchEvidenceDesc}</p>
                </div>
              ) : (
                /* PDF Scanned Pixmap View */
                <div className="bento-scan-viewport">
                  <div className="bento-scan-controls-bar">
                    <button
                      type="button"
                      className="bento-zoom-btn"
                      onClick={() => setZoomLevel((z) => Math.max(0.8, Number((z - 0.2).toFixed(1))))}
                    >
                      -
                    </button>
                    <span className="bento-zoom-label">{Math.round(zoomLevel * 100)}%</span>
                    <button
                      type="button"
                      className="bento-zoom-btn"
                      onClick={() => setZoomLevel((z) => Math.min(2.0, Number((z + 0.2).toFixed(1))))}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="bento-zoom-btn reset"
                      onClick={() => setZoomLevel(1.0)}
                    >
                      {t.resetZoom}
                    </button>
                  </div>

                  <div className="bento-scan-canvas-area">
                    {pageImageError ? (
                      <div className="bento-scan-error-card">
                        <span className="error-tag-badge">[RENDERER OFFLINE]</span>
                        <h4 className="error-card-title">Page {pageNumber} scan could not be fetched</h4>
                        <p className="error-card-text">
                          The backend server was unreachable on port 8000. Please ensure the backend is running.
                        </p>
                        <div className="error-actions-row">
                          <button
                            type="button"
                            className="btn-lime-pill"
                            onClick={() => {
                              setImgAttempt(0);
                              setImgSrc(getPrimaryImageUrl(packId, pageNumber));
                              setPageImageError(false);
                              setPageImageLoading(true);
                            }}
                          >
                            <span>RETRY FETCH</span>
                            <span>↗</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="bento-pixmap-wrapper"
                        style={{
                          position: "relative",
                          display: "inline-block",
                          width: `${Math.round(zoomLevel * 100)}%`,
                          maxWidth: zoomLevel <= 1.0 ? "100%" : "none",
                        }}
                      >
                        {pageImageLoading && (
                          <div className="bento-scan-loading-tag">
                            Rendering PDF Page {pageNumber}...
                          </div>
                        )}
                        <img
                          key={`${packId}-${pageNumber}-${imgAttempt}`}
                          src={imgSrc}
                          alt={`PDF Page ${pageNumber}`}
                          className="bento-pixmap-image"
                          onLoad={() => {
                            setPageImageLoading(false);
                            setPageImageError(false);
                          }}
                          onError={() => {
                            if (imgAttempt === 0) {
                              setImgAttempt(1);
                              setImgSrc(getFallbackImageUrl(packId, pageNumber));
                            } else {
                              setPageImageLoading(false);
                              setPageImageError(true);
                            }
                          }}
                        />

                        {/* Bounding Box Highlight Overlay */}
                        {!pageImageError && highlightSource && activeCitation.page_number === pageNumber && activeCitation.bbox && (
                          <div
                            className="bento-bbox-overlay"
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
              )}

              {/* Alternative Passages Considered Dock */}
              {activeMessage?.citations?.length > 1 && (
                <div className="bento-alt-passages-dock">
                  <span className="alt-dock-tag">{t.altPassagesTitle}</span>
                  <div className="alt-chips-row">
                    {activeMessage.citations.map((c, i) => {
                      const isSelected = i === activeCiteIdx;
                      return (
                        <button
                          key={i}
                          type="button"
                          className={`alt-citation-chip ${isSelected ? "active" : ""}`}
                          onClick={() => {
                            setActiveCiteIdx(i);
                            setPageNumber(c.page_number);
                          }}
                        >
                          <span className="chip-pnum">p.{c.page_number}</span>
                          <span className="chip-topic">{normalizeDevanagari(c.topic)}</span>
                          <span className="chip-score">{(c.score * 100).toFixed(0)}%</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
