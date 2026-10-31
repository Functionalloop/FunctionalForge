"""Bhasha Mentor offline API.   Run:  cd backend && uvicorn main:app --port 8000"""
import config  # noqa: F401  (must be first)

import asyncio
import json
from pathlib import Path
import re
import shutil
import time
from contextlib import asynccontextmanager
from typing import Optional

import fitz
from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
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
    if STATE.get("embedder") is None:
        STATE["embedder"] = load_embedder()
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
            pdf = _find_pdf(d)
            total_pages = 0
            if pdf:
                try:
                    doc = fitz.open(str(pdf))
                    total_pages = len(doc)
                    doc.close()
                except Exception:
                    pass
            out.append({
                "id": d.name,
                "title": info.get("title", d.name),
                "description": info.get("description", ""),
                "sample_questions": info.get("sample_questions", []),
                "book_page_offset": info.get("book_page_offset", 314),
                "indexed": r is not None,
                "chunks": len(r.chunks) if r else 0,
                "total_pages": total_pages,
            })
    return out


@app.get("/benchmarks")
def benchmarks():
    f = config.BASE_DIR / "tkd_questions.json"
    if f.exists():
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


@app.get("/page-image")
def page_image(pack_id: str = "tk-d", page_number: int = 1, dpi: int = 150):
    d = _pack_dir(pack_id)
    pdf = _find_pdf(d)
    if not pdf:
        raise HTTPException(404, "PDF not found.")
    try:
        doc = fitz.open(str(pdf))
        total_pages = len(doc)
        if page_number < 1 or page_number > total_pages:
            doc.close()
            raise HTTPException(400, f"Page number {page_number} out of range (1..{total_pages}).")
        page = doc[page_number - 1]
        rect = page.rect
        pix = page.get_pixmap(dpi=dpi)
        img_bytes = pix.tobytes("png")
        page_width, page_height = rect.width, rect.height
        doc.close()
        return Response(
            content=img_bytes,
            media_type="image/png",
            headers={
                "X-Page-Width": str(page_width),
                "X-Page-Height": str(page_height),
                "X-Total-Pages": str(total_pages),
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Rendering page error: {e}")


@app.get("/api/packs/{pack_id}/page/{page_num}")
def page_image_api(pack_id: str, page_num: int, dpi: int = 150):
    return page_image(pack_id=pack_id, page_number=page_num, dpi=dpi)


@app.post("/ingest")
async def ingest(
    pack_id: Optional[str] = Form(None),
    chapter_name: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
):
    if file is None and not pack_id:
        raise HTTPException(400, "Provide a PDF file or pack_id.")
    if file is not None:
        if not (file.filename or "").lower().endswith(".pdf"):
            raise HTTPException(400, "Upload a .pdf file.")
        if not pack_id:
            raw_stem = Path(file.filename).stem
            clean_id = re.sub(r"[^A-Za-z0-9_-]", "_", raw_stem)[:28].strip("_").lower()
            pack_id = clean_id or f"doc_{int(time.time())}"

        d = _pack_dir(pack_id, create=True)
        pdf_path = d / "chapter.pdf"
        content = await file.read()
        with open(pdf_path, "wb") as f:
            f.write(content)

        doc_title = chapter_name or Path(file.filename).stem.replace("_", " ").title()
        info_file = d / "info.json"
        info = {
            "title": doc_title,
            "chapter": doc_title,
            "description": f"Uploaded document: {file.filename}",
            "book_page_offset": 0,
            "sample_questions": [
                f"What are the main concepts discussed in {doc_title}?",
                "Summarize the key points in this document.",
                "Explain the first topic in detail."
            ]
        }
        info_file.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    else:
        d = _pack_dir(pack_id, create=True)

    result = await asyncio.to_thread(_index_pack, pack_id, True, chapter_name)
    return {"status": "indexed", "pack_id": pack_id, **result}


class AskRequest(BaseModel):
    pack_id: str = "tk-d"
    question: str
    language: Optional[str] = "en"


def _retrieve(req: AskRequest):
    q = req.question.strip()
    if not q:
        raise HTTPException(400, "Empty question.")
    r = STATE["retrievers"].get(req.pack_id)
    if r is None:
        raise HTTPException(404, f"Pack '{req.pack_id}' is not indexed. POST /ingest first.")
    return q, r.search(q, top_k=config.TOP_K)


def _check_section_warning(topic: str) -> Optional[str]:
    t = (topic or "").lower()
    summary_keywords = ["सारांश", "summary", "अभ्यास", "exercise", "विचारणीय", "thought", "प्रश्न", "question"]
    if any(k in t for k in summary_keywords):
        return "This passage comes from the chapter summary, questions, or exercise section."
    return None


def _citations(chunks):
    out = []
    for c in chunks:
        score = float(c.get("score", 0.0))
        if score >= 0.70:
            match_level = "strong"
        elif score >= 0.35:
            match_level = "weak"
        else:
            match_level = "none"

        out.append({
            "page_number": c["page_number"],
            "chapter": c["chapter"],
            "topic": c["topic"],
            "snippet": c["text"],
            "score": score,
            "match_level": match_level,
            "bbox": c.get("bbox"),
            "section_warning": _check_section_warning(c.get("topic", "")),
            "pdf_filename": c["pdf_filename"],
        })
    return out


@app.post("/ask")
def ask(req: AskRequest):
    t0 = time.time()
    q, chunks = _retrieve(req)
    lang = req.language or "en"
    if not chunks:
        not_avail = "This information is not available in the indexed document." if lang != "hi" else "इस दस्तावेज़ में यह जानकारी उपलब्ध नहीं है।"
        return {"answer": not_avail, "citations": [], "latency_ms": 0}
    try:
        answer = llm.generate(llm.build_prompt(q, chunks, language=lang))
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
    lang = req.language or "en"

    def gen():
        yield _line({"type": "citations", "citations": _citations(chunks)})
        if chunks:
            try:
                for tok in llm.generate_stream(llm.build_prompt(q, chunks, language=lang)):
                    yield _line({"type": "token", "text": tok})
            except llm.OllamaUnavailable as e:
                yield _line({"type": "error", "message": str(e)})
        yield _line({"type": "done", "latency_ms": int((time.time() - t0) * 1000)})

    return StreamingResponse(gen(), media_type="application/x-ndjson")


# Serve the built React app from the same port (one process for the demo). Keep LAST.
if config.FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(config.FRONTEND_DIST), html=True), name="ui")
