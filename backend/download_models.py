"""Run ONCE while online:  python backend/download_models.py
Saves multilingual-e5-small to ./models/e5-small so the app never needs internet again."""
from pathlib import Path

from sentence_transformers import SentenceTransformer

dest = Path(__file__).resolve().parent.parent / "models" / "e5-small"
dest.parent.mkdir(parents=True, exist_ok=True)
model = SentenceTransformer("intfloat/multilingual-e5-small", device="cpu")
model.save(str(dest))
vec = model.encode(["query: भारत की राजधानी क्या है?"], normalize_embeddings=True)
print(f"saved to {dest}  |  smoke test embedding shape: {vec.shape}")
