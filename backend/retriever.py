"""Hybrid retriever: Rank-BM25 (keywords) + multilingual-e5-small (semantic),
fused with Reciprocal Rank Fusion (RRF)."""
import config  # noqa: F401  (must be first: sets offline env vars)

import hashlib
import re
from pathlib import Path

import numpy as np
from rank_bm25 import BM25Okapi

# Devanagari letters + matras + digits, WITHOUT the danda marks (U+0964/0965).
# \w would drop matras, and str.split() would leave "है।" glued together.
_TOKEN_RE = re.compile(r"[\u0900-\u0963\u0966-\u097Fa-zA-Z0-9]+")


def tokenize(text: str):
    return _TOKEN_RE.findall(text.lower())


def load_embedder(model_dir=config.MODEL_DIR):
    model_dir = Path(model_dir)
    if not model_dir.exists():
        raise RuntimeError(
            f"Embedding model not found at {model_dir}.\n"
            "Run once WITH internet:  python backend/download_models.py"
        )
    from sentence_transformers import SentenceTransformer  # lazy: keeps tests/imports light
    return SentenceTransformer(str(model_dir), device="cpu", local_files_only=True)


def _rrf(scores: np.ndarray, k: int, mask=None) -> np.ndarray:
    """Reciprocal rank fusion contribution: 1 / (k + rank)."""
    order = np.argsort(-scores, kind="stable")
    out = np.zeros(len(scores))
    for rank, idx in enumerate(order):
        if mask is not None and not mask[idx]:
            continue
        out[idx] = 1.0 / (k + rank + 1)
    return out


class HybridRetriever:
    def __init__(self, embedder, rrf_k: int = config.RRF_K):
        self.embedder = embedder
        self.rrf_k = rrf_k
        self.chunks, self.bm25, self.embeddings = [], None, None

    def build_index(self, chunks, cache_dir=None):
        self.chunks = chunks
        if not chunks:
            self.bm25, self.embeddings = None, None
            return
        corpus = [f"{c['chapter']} {c['topic']} {c['text']}" for c in chunks]
        self.bm25 = BM25Okapi([tokenize(d) or ["_"] for d in corpus])

        passages = [f"passage: {c['topic']} - {c['text']}" for c in chunks]
        digest = hashlib.md5(("e5-small-v1\n" + "\n".join(passages)).encode("utf-8")).hexdigest()
        emb_file = hash_file = None
        if cache_dir:
            Path(cache_dir).mkdir(parents=True, exist_ok=True)
            emb_file, hash_file = Path(cache_dir) / "embeddings.npy", Path(cache_dir) / "embeddings.md5"
            if emb_file.exists() and hash_file.exists() and hash_file.read_text() == digest:
                self.embeddings = np.load(emb_file)
                return
        self.embeddings = np.asarray(
            self.embedder.encode(passages, normalize_embeddings=True, batch_size=32, show_progress_bar=False)
        )
        if emb_file:
            np.save(emb_file, self.embeddings)
            hash_file.write_text(digest)

    def search(self, query: str, top_k: int = config.TOP_K):
        if not self.chunks:
            return []
        bm = np.asarray(self.bm25.get_scores(tokenize(query)), dtype=float)
        q = self.embedder.encode([f"query: {query}"], normalize_embeddings=True)[0]
        sem = self.embeddings @ q

        fused = _rrf(bm, self.rrf_k, mask=bm > 0) + _rrf(sem, self.rrf_k)
        best_possible = 2.0 / (self.rrf_k + 1)          # rank 1 in both lists => 1.0
        results = []
        for idx in np.argsort(-fused, kind="stable")[:top_k]:
            c = dict(self.chunks[int(idx)])
            c["score"] = round(float(fused[idx] / best_possible), 3)
            c["semantic"] = round(float(sem[idx]), 3)
            c["keyword"] = round(float(bm[idx]), 3)
            results.append(c)
        return results
