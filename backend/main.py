"""Bhasha Mentor offline API.   Run:  cd backend && uvicorn main:app --port 8000"""
import config  # noqa: F401  (must be first)

import json
import re
import shutil
import time
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import llm
from pdf_parser import load_index, parse_pdf, save_index
from retriever import HybridRetriever, load_embedder

STATE = {"embedder": None, "retrievers": {}}
PACK_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")


# ---------- pack helpers ----------
def _pack_dir(pack_id: str, create: bool = False):
    if not PACK_ID_RE.match(pack_id):
        raise HTTPException(400, "Invalid pack_id (use letters, digits, - or _).")
    d = config.PACKS_DIR / pack_id
    if create:
        d.mkdir(parents=True, exist_ok=True)
    return d


def _read_info(pack_dir) -> dict:
    f = pack_dir / "info.json"
    if f.exists():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _find_pdf(pack_dir):
    pref = pack_dir / "chapter.pdf"
    if pref.exists():
        return pref
    pdfs = sorted(pack_dir.glob("*.pdf"))
    return pdfs[0] if pdfs else None


def _index_pack(pack_id: str, force: bool = False, chapter_name: Optional[str] = None) -> dict:
    d = _pack_dir(pack_id)
    info = _read_info(d)
    pdf, index_file = _find_pdf(d), d / "index.json"
    pages = None
    fresh_index = (
        index_file.exists() and (pdf is None or index_file.stat().st_mtime >= pdf.stat().st_mtime)
    )
    if fresh_index and not force:
        chunks = load_index(index_file)
    elif pdf is not None:
        chapter = chapter_name or info.get("chapter") or info.get("title") or "अध्याय 1"
        chunks, pages = parse_pdf(str(pdf), chapter)
        save_index(chunks, index_file)
    else:
        raise HTTPException(404, f"No PDF or index.json in pack '{pack_id}'.")
    r = HybridRetriever(STATE["embedder"])
    r.build_index(chunks, cache_dir=d / ".cache")
    STATE["retrievers"][pack_id] = r
    return {"pack_id": pack_id, "chunks": len(chunks), "pages_parsed": pages}


@asynccontextmanager
async def lifespan(app: FastAPI):
    STATE["embedder"] = load_embedder()           # fails loudly if the model isn't on disk
    if config.PACKS_DIR.exists():
        for d in sorted(config.PACKS_DIR.iterdir()):
            if d.is_dir():
                try:
                    print("indexed:", _index_pack(d.name))
                except Exception as e:
                    print(f"skip pack {d.name}: {e}")
    yield


app = FastAPI(title="Bhasha Mentor Offline API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ---------- endpoints ----------
@app.get("/health")
def health():
    ready = llm.ollama_ready()
    return {
        "status": "ok" if ready else "ollama_not_ready",
        "offline_mode": True,
        "ollama_model": config.OLLAMA_MODEL,
        "ollama_ready": ready,
        "indexed_packs": sorted(STATE["retrievers"]),
    }


@app.get("/packs")
def packs():
    out = []
    if config.PACKS_DIR.exists():
        for d in sorted(config.PACKS_DIR.iterdir()):
            if not d.is_dir():
                continue
            info, r = _read_info(d), STATE["retrievers"].get(d.name)
            out.append({
                "id": d.name,
                "title": info.get("title", d.name),
                "description": info.get("description", ""),
                "sample_questions": info.get("sample_questions", []),
                "indexed": r is not None,
                "chunks": len(r.chunks) if r else 0,
            })
    return out


@app.post("/ingest")
async def ingest(
    pack_id: str = Form("tk-d"),
    chapter_name: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
):
    d = _pack_dir(pack_id, create=True)
    if file is not None:
        if not (file.filename or "").lower().endswith(".pdf"):
            raise HTTPException(400, "Upload a .pdf file.")
        with open(d / "chapter.pdf", "wb") as f:
            shutil.copyfileobj(file.file, f)
    return {"status": "indexed", **_index_pack(pack_id, force=True, chapter_name=chapter_name)}


class AskRequest(BaseModel):
    pack_id: str = "tk-d"
    question: str


def _retrieve(req: AskRequest):
    q = req.question.strip()
    if not q:
        raise HTTPException(400, "Empty question.")
    r = STATE["retrievers"].get(req.pack_id)
    if r is None:
        raise HTTPException(404, f"Pack '{req.pack_id}' is not indexed. POST /ingest first.")
    return q, r.search(q, top_k=config.TOP_K)


def _citations(chunks):
    return [{
        "page_number": c["page_number"],   # straight from parser metadata, never from the LLM
        "chapter": c["chapter"],
        "topic": c["topic"],
        "snippet": c["text"],
        "score": c["score"],
        "pdf_filename": c["pdf_filename"],
    } for c in chunks]


@app.post("/ask")
def ask(req: AskRequest):
    t0 = time.time()
    q, chunks = _retrieve(req)
    if not chunks:
        return {"answer": "इस पैक में कोई पाठ नहीं मिला।", "citations": [], "latency_ms": 0}
    try:
        answer = llm.generate(llm.build_prompt(q, chunks))
    except llm.OllamaUnavailable as e:
        raise HTTPException(503, str(e))
    return {"answer": answer, "citations": _citations(chunks), "latency_ms": int((time.time() - t0) * 1000)}


def _line(obj) -> str:
    return json.dumps(obj, ensure_ascii=False) + "\n"


@app.post("/ask/stream")
def ask_stream(req: AskRequest):
    """NDJSON stream: citations first (instant), then answer tokens, then done."""
    t0 = time.time()
    q, chunks = _retrieve(req)

    def gen():
        yield _line({"type": "citations", "citations": _citations(chunks)})
        if chunks:
            try:
                for tok in llm.generate_stream(llm.build_prompt(q, chunks)):
                    yield _line({"type": "token", "text": tok})
            except llm.OllamaUnavailable as e:
                yield _line({"type": "error", "message": str(e)})
        yield _line({"type": "done", "latency_ms": int((time.time() - t0) * 1000)})

    return StreamingResponse(gen(), media_type="application/x-ndjson")


# Serve the built React app from the same port (one process for the demo). Keep LAST.
if config.FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(config.FRONTEND_DIST), html=True), name="ui")
