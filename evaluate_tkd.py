"""Run the 5 official TK-D questions against the running server and check page citations.
Usage (server must be running):  python evaluate_tkd.py
Fill tkd_questions.json first. expected_page = physical PDF page (what the UI shows)."""
import json
import time
from pathlib import Path

import requests

API = "http://127.0.0.1:8000"
items = json.loads((Path(__file__).parent / "tkd_questions.json").read_text(encoding="utf-8"))

top1 = top3 = 0
for i, item in enumerate(items, 1):
    t0 = time.time()
    r = requests.post(f"{API}/ask", json={"pack_id": "tk-d", "question": item["question"]}, timeout=300)
    r.raise_for_status()
    j = r.json()
    pages = [c["page_number"] for c in j["citations"]]
    exp = item.get("expected_page")
    hit1, hit3 = bool(pages) and pages[0] == exp, exp in pages
    top1 += hit1
    top3 += hit3
    print(f"\nQ{i}: {item['question']}")
    print(f"   expected page {exp} | cited pages {pages} | top-1 {'PASS' if hit1 else 'FAIL'} | in top-3 {'yes' if hit3 else 'no'}")
    print(f"   topic: {j['citations'][0]['topic'] if j['citations'] else '-'}")
    print(f"   latency: {j['latency_ms'] / 1000:.1f}s (wall {time.time() - t0:.1f}s)")
    print(f"   answer: {j['answer'][:300]}")
print(f"\nSUMMARY  top-1 page correct: {top1}/{len(items)}   expected page within top-3: {top3}/{len(items)}")
