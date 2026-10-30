# Bhasha Mentor: step-by-step build guide

Times are relative to when you start (T+0:00). Finals window is 12 hours; this plan uses about 7
and leaves the rest as buffer. Commands are for the repo root unless stated.
Windows differences are marked. Prerequisites: Python 3.10+, Node 18+, Git, Ollama installed.

**Roles**
- Tanishq: backend, model, architecture (Phases 0, 2)
- Shriyansh: PDF check, evaluation, offline rehearsal (Phases 1, 3, 4)
- Priyal: frontend, README, CONTRIBUTING, GitHub issues (Phases 0, 3, 4)

**If you fall behind, cut in this order:** upload button, multi-pack selector, streaming
(use `/ask`), "other passages" list. Never cut: correct page citation, offline run, preflight.

---

## Phase 0: Setup while the internet works (T+0:00 to 0:30)

Everything here needs Wi-Fi. Do it first, in parallel across the team.

**0.1 Project folder (Tanishq).** Unzip the starter into `bhasha-mentor/` and connect it to the repo:
```
cd bhasha-mentor
git init
git remote add origin https://github.com/Functionalloop/bhasha-mentor.git
```
(or clone the repo and copy the starter files in).

**0.2 Ollama model (Tanishq).**
```
ollama pull qwen2.5:3b-instruct-q4_K_M
ollama create bhasha-hindi -f backend/Modelfile
ollama run bhasha-hindi "नमस्ते, आप कौन हैं?"
```
The last command is a smoke test; it should reply in Hindi. Type `/bye` to exit.

**0.3 Python environment (Tanishq, Shriyansh).**
```
python -m venv venv
venv\Scripts\activate          # Windows
source venv/bin/activate       # Mac/Linux
pip install -r backend/requirements.txt
```
On Linux, if `torch` starts pulling a multi-GB CUDA build, first run
`pip install torch --index-url https://download.pytorch.org/whl/cpu`.

**0.4 Save the embedding model locally (Tanishq).**
```
python backend/download_models.py
```
This creates `models/e5-small/`. It is gitignored, so every demo laptop must run it once (README step).

**0.5 Frontend packages (Priyal).**
```
cd frontend
npm install
```
Leave this folder; `node_modules` must exist before Wi-Fi goes off.

**Milestone:** `ollama run` answers in Hindi, `models/e5-small/` exists, `npm install` finished.

---

## Phase 1: Prove the PDF parser works (T+0:30 to 1:15)  *go / no-go*

This is the biggest risk. Do it before anything else.

**1.1** Copy the official PDF to `content-packs/tk-d/chapter.pdf`.

**1.2** Run the checker:
```
python backend/pdf_parser.py content-packs/tk-d/chapter.pdf
```

**1.3** Read the output:

| What you see | Meaning | Fix |
|---|---|---|
| `devanagari ratio` near 0 and the text looks like random Latin symbols | PDF uses legacy (non-Unicode) Hindi fonts, or is scanned | Ask organisers for another copy; else OCR (`pytesseract` + Hindi `tessdata`, installed now while online); last resort: copy-paste text into a Unicode `.txt`/new PDF |
| Topics list is empty or only "सामान्य परिचय" | No headings detected | Lower `HEADING_RATIO` in `pdf_parser.py` to `1.05` |
| Every line is a topic | Too many false headings | Raise `HEADING_RATIO` to `1.3` |
| The same title repeats as the topic on every page | Running header is being read as a heading | Raise `MARGIN_FRAC` to `0.09` |
| Words cut in odd places / spaces inside words | Font spans split words | Tell Tanishq; it is a parser tweak |

**1.4 Verify page numbers by hand (Shriyansh).** Open `content-packs/tk-d/index.json` (created in
Phase 2, or run the parser CLI). Pick 5 random chunks, search for their text in the PDF viewer, and
confirm the `page_number` matches the **PDF viewer page** (not the number printed on the page).
Decide with the team: the UI says "PDF page". If judges compare with printed page numbers, mention
the offset in the demo.

**Milestone:** topics look sensible, text is readable Hindi, 5/5 spot-checked pages correct.

---

## Phase 2: Backend end to end (T+1:15 to 2:30)

**2.1 Start the API.**
```
cd backend
uvicorn main:app --port 8000
```
First start parses the PDF, writes `content-packs/tk-d/index.json`, and embeds all chunks
(cached in `.cache/` afterwards). You should see `indexed: {'pack_id': 'tk-d', ...}`.
If it says the embedding model is missing, repeat step 0.4.

**2.2 Test in the browser, not curl** (Hindi in Windows terminals is painful).
Open `http://localhost:8000/docs`:
- `GET /health` -> `ollama_ready` must be `true`.
- `GET /packs` -> `tk-d` with `"indexed": true`.
- `POST /ask` -> Try it out with `{"pack_id": "tk-d", "question": "<one TK-D question in Hindi>"}`.

**2.3 Check three things in the response:**
1. `answer` is Hindi and grounded in the passage.
2. `citations[0].page_number` is the right PDF page.
3. `citations[0].snippet` really contains the answer.

**2.4 If retrieval picks the wrong page:**
- Check the snippet text; if the answer is split across two chunks, raise `CHUNK_SIZE` to `600` in `pdf_parser.py`, delete `content-packs/tk-d/index.json`, restart.
- If the answer is right but the model rambles or says "not available": set `TOP_K=2` (environment variable) or shorten chunks. Ollama truncates prompts that exceed `num_ctx`.

**Milestone:** one TK-D question returns a correct Hindi answer and the correct page.

---

## Phase 3: Frontend and the 5 official questions (T+2:30 to 4:00)

**3.1 Put the 5 TK-D questions in two places (Shriyansh):**
- `content-packs/tk-d/info.json` -> `sample_questions` (these become one-click buttons in the UI)
- `tkd_questions.json` -> `question` + `expected_page` (PDF page from the viewer)

**3.2 Run the UI in dev mode (Priyal).** With the backend still running:
```
cd frontend
npm run dev
```
Open `http://localhost:5173`. You should see: green status pill, the TK-D sample buttons, a chat
box, and a right-hand panel showing the big PDF page number, `chapter › topic`, and the highlighted passage.
The answer streams in token by token; the page panel fills instantly.

**3.3 Run the evaluation (Shriyansh).** Backend running, repo root, venv active:
```
python evaluate_tkd.py
```
Target: 5/5 "top-1 PASS". For each FAIL, look at which page was cited and why (wrong chunk boundary,
missing keyword, heading mis-detected) and fix at the parser/retriever level, not with hard-coded answers.

**Milestone:** 5/5 TK-D questions return the right page; the UI shows it clearly.

---

## Phase 4: One-process build and airplane-mode rehearsal (T+4:00 to 6:30)

**4.1 Build the UI so FastAPI serves it (Priyal).**
```
cd frontend
npm run build
```
Now `http://localhost:8000` serves the whole app from one process.

**4.2 Preflight (Shriyansh):**
```
python backend/preflight.py
```
Every line should be OK. It also tells you whether the internet is currently on.

**4.3 The real rehearsal, with Wi-Fi OFF:**
1. Turn Wi-Fi off (and unplug Ethernet).
2. Quit Ollama completely and start it again. Close the backend.
3. Start backend: `cd backend && uvicorn main:app --port 8000`
4. Open `http://localhost:8000`, click each of the 5 sample questions.
5. Run `python evaluate_tkd.py` and note the latency of each question.
Anything that tries to download something now is a bug; common culprits are in the table at the end.

**4.4 Repo polish (Priyal), in parallel with 4.3.**
- `README.md`: one-paragraph pitch; the flow diagram `PDF -> parser (Chapter > Topic > Page) -> BM25 + E5 -> RRF -> top 3 passages -> Qwen2.5-3B (Ollama) -> Hindi answer + page from metadata`; and the 3-step offline setup:
  1. `pip install -r backend/requirements.txt`, `python backend/download_models.py`
  2. `ollama pull qwen2.5:3b-instruct-q4_K_M` then `ollama create bhasha-hindi -f backend/Modelfile`
  3. `cd backend && uvicorn main:app --port 8000`, open `http://localhost:8000`
- `CONTRIBUTING.md`: how to run locally, how to add a content pack (folder with PDF + `info.json`), code style, PR checklist.
- `LICENSE` is already MIT.
- Open 3 issues labelled `good-first-issue`. Ideas that match the architecture:
  1. Add a pack-validation command that reports pages with no extractable text
  2. Add OCR fallback for scanned PDFs
  3. Add support for another Indian language (tokenizer + Modelfile prompt)

**Milestone:** whole demo works offline from a cold start; README and issues are up.

---

## Phase 5: Freeze (T+6:30 onwards, finish well before 10:00 AM)

- [ ] `git add -A && git commit -m "Finals build" && git push` (do this while still online; confirm on GitHub)
- [ ] `git tag finals-freeze && git push --tags`
- [ ] Demo laptop: plugged in, power mode on "best performance", other apps closed
- [ ] `models/e5-small/` present on the demo laptop; `ollama list` shows `bhasha-hindi`
- [ ] Pre-warm 5 minutes before judges: ask one question so the model is loaded in RAM
- [ ] Record a 60-90 second screen capture of a full successful run (fallback if hardware misbehaves)
- [ ] Do not change code after the final rehearsal passes

**What to tell judges about speed:** the page citation appears instantly and the answer streams
as it is generated; a 3B model on a CPU-only laptop will not be instant, and that is the trade-off
for running fully offline.

---

## Troubleshooting

| Problem | Likely cause and fix |
|---|---|
| Backend crashes at start: "Embedding model not found" | Run `python backend/download_models.py` once while online |
| Something tries to reach huggingface.co offline | You bypassed `config.py`; make sure `import config` is the first import in the module |
| `/health` says `ollama_not_ready` | Start Ollama; run `ollama create bhasha-hindi -f backend/Modelfile` |
| UI shows "Server not reachable" | Backend not running on :8000; in dev mode the UI is on :5173 and calls :8000 |
| `http://localhost:8000` shows 404 for `/` | Frontend not built; `cd frontend && npm run build` |
| Hindi text looks like boxes in the UI | Install a Devanagari font (Noto Sans Devanagari); Windows has Nirmala UI by default |
| Answers are cut mid-sentence | `NUM_PREDICT` (default 220) reached; set `NUM_PREDICT=300` |
| Answer ignores the passage or says "not available" for a question that is in the book | Wrong chunk retrieved (check the citation) or prompt too long; try `TOP_K=2` |
| Very slow first answer | Model loading into RAM; pre-warm. Also keep the laptop on AC power |
| After editing the parser, nothing changes | Delete `content-packs/tk-d/index.json` and restart (or POST `/ingest`) |
| Page number off by a few | You are comparing with the printed page number, not the PDF viewer page |
