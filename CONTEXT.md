# PROJECT CONTEXT: Bhasha Mentor (PS-11)

**Team:** FunctionalX (Tanishq Naik, Shriyansh Narvekar, Priyal Nagvekar)
**Track:** Track 5 · Open Source for Bharat
**Event:** Devf8rge Hacktoberfest Hack Day, offline finals build
**Code freeze:** 31 Oct 2026, 10:00 AM IST
**Repo:** github.com/Functionalloop/bhasha-mentor

You are an AI coding assistant helping build **Bhasha Mentor**: a 100% offline, CPU-only
study assistant that answers Hindi questions from a local textbook PDF and shows the
**exact PDF page** the answer came from. Target machine: low-end laptop, 8 GB RAM,
integrated graphics, no GPU, Wi-Fi OFF during judging.

## 1. Non-negotiable rules

1. **Offline at runtime.** No external calls after setup. Everything talks to `localhost`
   only (FastAPI :8000, Ollama :11434). `HF_HUB_OFFLINE=1` is set in `backend/config.py`,
   which every module imports first. No CDN links, no Google Fonts, no analytics in the frontend.
2. **Metadata-locked citations.** The LLM never sees, generates or guesses page numbers.
   `page_number` and `topic` come from PyMuPDF at ingestion and are copied from the retrieved
   chunk into the API response. Page numbers are NOT in the prompt.
3. **Structured chunks.** Each chunk: `chapter`, `topic`, `page_number` (physical PDF page,
   1-indexed), `text`. The UI labels it "PDF page" because it can differ from the number
   printed on the textbook page.
4. **Hybrid retrieval.** Rank-BM25 (Hindi-aware tokenizer) + `intfloat/multilingual-e5-small`
   (`"query: "` / `"passage: "` prefixes), fused with **Reciprocal Rank Fusion** (k=60).
5. **Local LLM via Ollama.** `qwen2.5:3b-instruct-q4_K_M` wrapped as `bhasha-hindi` using
   `backend/Modelfile` (Hindi-only, answer only from the supplied context, 3-5 sentences).
6. **Honest performance claims.** Do not promise a latency number. First streamed token
   within a few seconds; full Hindi answers on a CPU laptop can take 15-40 s. Stream tokens.

## 2. Directory structure

```
bhasha-mentor/
├── CONTEXT.md  BUILD_GUIDE.md  README.md  CONTRIBUTING.md  LICENSE  .gitignore
├── evaluate_tkd.py            # runs the 5 TK-D questions, checks cited pages
├── tkd_questions.json         # {question, expected_page} x5  (fill in)
├── models/e5-small/           # saved embedding model (gitignored, created by download_models.py)
├── backend/
│   ├── config.py              # paths, offline env vars, Ollama settings  (import FIRST)
│   ├── pdf_parser.py          # PyMuPDF: PDF -> chunks; CLI check: python pdf_parser.py file.pdf
│   ├── retriever.py           # tokenizer, HybridRetriever (BM25 + E5 + RRF), embedding cache
│   ├── llm.py                 # Ollama client (prompt builder, generate, generate_stream)
│   ├── main.py                # FastAPI: /health /packs /ingest /ask /ask/stream (+ serves built UI)
│   ├── download_models.py     # one-time, needs internet
│   ├── preflight.py           # pre-demo checklist
│   ├── Modelfile
│   └── requirements.txt
├── content-packs/
│   └── tk-d/                  # chapter.pdf, info.json (title, chapter, sample_questions), index.json (generated)
└── frontend/                  # React + Vite, plain CSS (no Tailwind): src/App.jsx, src/index.css
```

## 3. Data contracts

### Chunk (`content-packs/<pack>/index.json` is a list of these)
```json
{
  "chunk_id": "p4_c7",
  "chapter": "TK-D अध्याय",
  "topic": "1.2 मुख्य विषय",
  "page_number": 4,
  "text": "Exact Hindi text extracted from the PDF page...",
  "pdf_filename": "chapter.pdf"
}
```

### Endpoints (`backend/main.py`)
- `GET /health` -> `{"status": "ok"|"ollama_not_ready", "offline_mode": true, "ollama_model": "bhasha-hindi", "ollama_ready": bool, "indexed_packs": [...]}`
- `GET /packs` -> `[{"id","title","description","sample_questions","indexed","chunks"}]`
- `POST /ingest` (multipart: `pack_id`, optional `chapter_name`, optional `file` PDF) -> `{"status":"indexed","pack_id","chunks","pages_parsed"}`.
  An uploaded PDF is saved as `content-packs/<pack_id>/chapter.pdf`.
- `POST /ask` body `{"pack_id": "tk-d", "question": "..."}` ->
  ```json
  {
    "answer": "हिंदी उत्तर...",
    "citations": [
      {"page_number": 4, "chapter": "...", "topic": "...", "snippet": "matched passage", "score": 0.87, "pdf_filename": "chapter.pdf"}
    ],
    "latency_ms": 18420
  }
  ```
  `citations` has up to 3 entries, best first. `score` is the RRF score normalised to 0-1.
- `POST /ask/stream` same body; NDJSON lines: `{"type":"citations",...}` (instant), then
  `{"type":"token","text":"..."}` repeatedly, then `{"type":"done","latency_ms":N}`
  (or `{"type":"error","message":"..."}`).

## 4. Implementation rules for the coding agent

1. **Paths** are built from `config.BASE_DIR` (`Path(__file__).resolve().parent.parent`). Never
   use cwd-relative paths like `./models/...`.
2. **Embeddings:** `SentenceTransformer(str(MODEL_DIR), device="cpu", local_files_only=True)`.
   Passages: `"passage: {topic} - {text}"`. Queries: `"query: {question}"`. Normalised vectors.
   Cache embeddings in `content-packs/<pack>/.cache/` keyed by a content hash.
3. **Tokenizer** for BM25: `re.findall(r"[\u0900-\u0963\u0966-\u097Fa-zA-Z0-9]+", text.lower())`.
   Do not use `str.split()` or `\w` (leaves "है।" glued; drops matras).
4. **Heading detection** (`pdf_parser.py`): `page.get_text("dict", sort=True)`; a block is a heading
   if its max span size > page median x 1.15 AND it is <= 120 characters. Skip blocks in the top/bottom
   6% of the page (running headers, printed page numbers). Text before a heading is emitted under the
   OLD topic. The topic carries across pages. Chunks ~450 chars, 80 overlap, cut on word boundaries.
5. **Prompt**: top 3 chunks, topic labels only, no page numbers. Ask for a Hindi answer in 3-5
   sentences. Do NOT ask the LLM for JSON.
6. **Ollama options** (keep identical on every call or the model reloads): `num_ctx 2048`,
   `temperature 0.1`, `top_p 0.85`, `num_predict 220`, `keep_alive "60m"`.
   Ollama silently truncates prompts longer than `num_ctx`; if answers go off-script, lower `TOP_K` to 2.
7. **Frontend**: plain CSS, system Devanagari font stack, no network assets. Right panel shows the
   big PDF page number, `chapter › topic`, the highlighted snippet, and the other retrieved passages.
8. Keep the code flat and readable. No new dependencies without a reason.

## 5. Definition of done

- Wi-Fi OFF, fresh restart of Ollama + backend (+ built UI at http://localhost:8000): all 5 TK-D
  questions answered in Hindi, `citations[0].page_number` matches the PDF page for each
  (`python evaluate_tkd.py`).
- `python backend/preflight.py` reports no FAIL.
- README has the 3-step offline setup; CONTRIBUTING + MIT LICENSE exist; 3 `good-first-issue` issues are open.
