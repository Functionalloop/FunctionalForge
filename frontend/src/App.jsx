import { useEffect, useRef, useState } from "react";

// In dev (npm run dev) talk to the API on :8000. When built, FastAPI serves this app, so same origin.
const API = import.meta.env.DEV ? "http://localhost:8000" : "";

export default function App() {
  const [health, setHealth] = useState(null);
  const [packs, setPacks] = useState([]);
  const [packId, setPackId] = useState("tk-d");
  const [messages, setMessages] = useState([]);
  const [active, setActive] = useState(-1);   // which answer the source panel shows
  const [citeIdx, setCiteIdx] = useState(0);  // which retrieved source is in focus
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState("");
  const endRef = useRef(null);

  const loadPacks = () =>
    fetch(`${API}/packs`).then((r) => r.json()).then((p) => {
      setPacks(p);
      if (p.length && !p.find((x) => x.id === packId)) setPackId(p[0].id);
    }).catch(() => {});

  useEffect(() => {
    const ping = () => fetch(`${API}/health`).then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
    ping();
    loadPacks();
    const t = setInterval(ping, 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const patch = (i, fn) => setMessages((m) => m.map((x, j) => (j === i ? fn(x) : x)));

  async function ask(q) {
    q = q.trim();
    if (!q || busy) return;
    const i = messages.length;
    setInput(""); setBusy(true); setActive(i); setCiteIdx(0);
    setMessages((m) => [...m, { q, a: "", citations: [], loading: true, latency: null, error: null }]);
    try {
      const res = await fetch(`${API}/ask/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack_id: packId, question: q }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Server error ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "citations") patch(i, (x) => ({ ...x, citations: ev.citations }));
          else if (ev.type === "token") patch(i, (x) => ({ ...x, a: x.a + ev.text }));
          else if (ev.type === "error") patch(i, (x) => ({ ...x, error: ev.message }));
          else if (ev.type === "done") patch(i, (x) => ({ ...x, loading: false, latency: ev.latency_ms }));
        }
      }
    } catch (e) {
      patch(i, (x) => ({ ...x, loading: false, error: String(e.message || e) }));
    } finally {
      patch(i, (x) => ({ ...x, loading: false }));
      setBusy(false);
    }
  }

  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUpload("Indexing…");
    const fd = new FormData();
    fd.append("pack_id", packId);
    fd.append("file", file);
    try {
      const r = await fetch(`${API}/ingest`, { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || "Upload failed");
      setUpload(`Indexed ${j.chunks} passages from ${j.pages_parsed} pages`);
      loadPacks();
    } catch (err) {
      setUpload(`Upload failed: ${err.message}`);
    }
    e.target.value = "";
  }

  const pack = packs.find((p) => p.id === packId);
  const cur = messages[active];
  const cite = cur?.citations?.[citeIdx];
  const online = health && health.ollama_ready;

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">
          <span className="brand-hi">भाषा मेंटर</span>
          <span className="brand-en">Bhasha Mentor</span>
        </div>
        <div className={`pill ${online ? "ok" : "warn"}`} title="All processing happens on this laptop">
          <span className="dot" />
          {health === null ? "Server not reachable" : online ? "Offline mode · local CPU (Qwen2.5-3B + E5)" : "Ollama model not ready"}
        </div>
        <div className="bar-tools">
          <select value={packId} onChange={(e) => setPackId(e.target.value)} aria-label="Content pack">
            {packs.map((p) => (<option key={p.id} value={p.id}>{p.title}</option>))}
          </select>
          <label className="btn">
            Upload textbook PDF
            <input type="file" accept="application/pdf" onChange={onUpload} hidden />
          </label>
        </div>
      </header>
      {upload && <div className="notice">{upload}</div>}

      <main className="split">
        <section className="chat" aria-label="Questions and answers">
          <div className="log">
            {messages.length === 0 && (
              <div className="empty">
                <p className="empty-title">पाठ्यपुस्तक से कोई भी प्रश्न पूछें</p>
                <p>Ask in Hindi. Every answer shows the exact textbook page it came from.</p>
              </div>
            )}
            {messages.map((m, i) => (
              <article key={i} className={`turn ${i === active ? "is-active" : ""}`} onClick={() => { setActive(i); setCiteIdx(0); }}>
                <p className="q">{m.q}</p>
                {m.error && <p className="err">{m.error}</p>}
                <p className="a">{m.a}{m.loading && <span className="caret" />}</p>
                {m.latency != null && <p className="meta">{(m.latency / 1000).toFixed(1)} s · page {m.citations[0]?.page_number ?? "–"}</p>}
              </article>
            ))}
            <div ref={endRef} />
          </div>

          {pack?.sample_questions?.length > 0 && (
            <div className="samples">
              {pack.sample_questions.map((s, i) => (
                <button key={i} className="chip" disabled={busy} onClick={() => ask(s)}>{s}</button>
              ))}
            </div>
          )}
          <div className="composer">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ask(input)}
              placeholder="अपना प्रश्न यहाँ लिखें…"
              aria-label="Your question"
            />
            <button className="btn primary" disabled={busy || !input.trim()} onClick={() => ask(input)}>
              {busy ? "Answering…" : "Ask"}
            </button>
          </div>
        </section>

        <aside className="source" aria-label="Source from the textbook">
          {!cite ? (
            <div className="empty"><p>The matching textbook page appears here after you ask a question.</p></div>
          ) : (
            <div className="sheet">
              <div className="folio">
                <span className="folio-label">PDF page</span>
                <span className="folio-num">{cite.page_number}</span>
              </div>
              <p className="crumb">{cite.chapter} › {cite.topic}</p>
              <blockquote className="snippet"><mark>{cite.snippet}</mark></blockquote>
              <p className="fine">Page and passage come from the PDF itself, not from the AI model. Match score {cite.score.toFixed(2)}.</p>
              {cur.citations.length > 1 && (
                <div className="others">
                  <p className="others-title">Other passages considered</p>
                  {cur.citations.map((c, k) => (
                    <button key={k} className={`other ${k === citeIdx ? "on" : ""}`} onClick={() => setCiteIdx(k)}>
                      Page {c.page_number} · {c.topic}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
