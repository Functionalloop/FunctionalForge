"""PyMuPDF parser: PDF -> structured chunks (chapter, topic, page_number, text).

Page numbers are the physical PDF page (1-indexed) read straight from PyMuPDF.
The LLM never sees or produces them.

Quick check on a real PDF:   python pdf_parser.py ../content-packs/tk-d/chapter.pdf
"""
import json
import os
import sys

import fitz  # PyMuPDF

CHUNK_SIZE = 450        # target characters per chunk
OVERLAP = 80            # characters repeated between consecutive chunks
MIN_FRESH = 20          # don't emit a chunk made only of overlap / crumbs
HEADING_RATIO = 1.15    # span size > page median * ratio => heading candidate
HEADING_MAX_CHARS = 120 # a heading is short; long big-font blocks are body text
MARGIN_FRAC = 0.06      # ignore blocks in the top/bottom 6% (running headers, printed page numbers)
DEFAULT_TOPIC = "सामान्य परिचय"


def _median_size(blocks):
    sizes = sorted(
        span["size"]
        for b in blocks if "lines" in b
        for line in b["lines"]
        for span in line["spans"]
        if span["text"].strip()
    )
    return sizes[len(sizes) // 2] if sizes else 11.0


def _block_text_and_size(block):
    """Join spans inside a line with no separator (Devanagari words can be split
    across spans), join lines with a space. Return (clean_text, max_span_size)."""
    lines, max_size = [], 0.0
    for line in block["lines"]:
        parts = []
        for span in line["spans"]:
            if span["text"].strip():
                max_size = max(max_size, span["size"])
            parts.append(span["text"])
        lines.append("".join(parts))
    return " ".join(" ".join(lines).split()), max_size


def parse_pdf(pdf_path, chapter_name="अध्याय 1"):
    """Return (chunks, page_count)."""
    doc = fitz.open(pdf_path)
    n_pages = len(doc)
    pdf_name = os.path.basename(pdf_path)
    chunks = []
    topic = DEFAULT_TOPIC

    def emit(page_num, topic_name, text):
        text = text.strip()
        if text:
            chunks.append({
                "chunk_id": f"p{page_num}_c{len(chunks)}",
                "chapter": chapter_name,
                "topic": topic_name,
                "page_number": page_num,
                "text": text,
                "pdf_filename": pdf_name,
            })

    for page_idx in range(n_pages):
        page = doc[page_idx]
        page_num = page_idx + 1
        page_h = page.rect.height
        blocks = page.get_text("dict", sort=True)["blocks"]
        median = _median_size(blocks)
        buf, fresh = "", 0   # fresh = characters added since the last emit (excludes overlap)

        for b in blocks:
            if "lines" not in b:
                continue
            x0, y0, x1, y1 = b["bbox"]
            if y1 < page_h * MARGIN_FRAC or y0 > page_h * (1 - MARGIN_FRAC):
                continue
            text, max_size = _block_text_and_size(b)
            if not text:
                continue

            is_heading = (
                max_size > median * HEADING_RATIO
                and 3 < len(text) <= HEADING_MAX_CHARS
            )
            if is_heading:
                if fresh >= MIN_FRESH:
                    emit(page_num, topic, buf)      # text before the heading belongs to the OLD topic
                buf, fresh = "", 0
                topic = text
                continue

            buf = f"{buf} {text}".strip()
            fresh += len(text) + 1
            while len(buf) >= CHUNK_SIZE:
                cut = buf.rfind(" ", int(CHUNK_SIZE * 0.6), CHUNK_SIZE)
                if cut == -1:
                    cut = CHUNK_SIZE
                emit(page_num, topic, buf[:cut])
                tail = buf[max(cut - OVERLAP, 0):]
                if cut - OVERLAP > 0:            # start the overlap on a word boundary, not mid-word
                    sp = tail.find(" ")
                    if 0 <= sp < len(tail) - 1:
                        tail = tail[sp + 1:]
                buf = tail.strip()
                fresh = max(len(buf) - OVERLAP, 0)

        if fresh >= MIN_FRESH:
            emit(page_num, topic, buf)

    doc.close()
    return chunks, n_pages


def parse_pdf_to_chunks(pdf_path, chapter_name="अध्याय 1"):
    return parse_pdf(pdf_path, chapter_name)[0]


def save_index(chunks, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(chunks, f, ensure_ascii=False, indent=2)


def load_index(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def devanagari_ratio(text):
    letters = [c for c in text if c.isalpha() or "\u0900" <= c <= "\u097F"]
    if not letters:
        return 0.0
    return sum(1 for c in letters if "\u0900" <= c <= "\u097F") / len(letters)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: python pdf_parser.py <file.pdf>")
    chunks, pages = parse_pdf(sys.argv[1])
    all_text = " ".join(c["text"] for c in chunks)
    print(f"pages={pages}  chunks={len(chunks)}  chars={len(all_text)}")
    print(f"devanagari ratio={devanagari_ratio(all_text):.2f}  (near 0 on a Hindi book => garbled fonts or scanned PDF)")
    print("\ntopics found (in order):")
    seen = []
    for c in chunks:
        if c["topic"] not in seen:
            seen.append(c["topic"])
            print(f"  p{c['page_number']:>3}  {c['topic']}")
    print("\nfirst chunks:")
    for c in chunks[:5]:
        print(f"--- p{c['page_number']} | {c['topic']}\n{c['text'][:200]}")
