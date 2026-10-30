"""Central config. Import this FIRST in every module so the offline env vars
are set before any HuggingFace / transformers import happens."""
import os
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

BASE_DIR = Path(__file__).resolve().parent.parent      # repo root, independent of cwd
PACKS_DIR = BASE_DIR / "content-packs"
MODEL_DIR = BASE_DIR / "models" / "e5-small"
FRONTEND_DIST = BASE_DIR / "frontend" / "dist"

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "bhasha-hindi")
TOP_K = int(os.getenv("TOP_K", "3"))            # chunks sent to the LLM
NUM_PREDICT = int(os.getenv("NUM_PREDICT", "220"))  # max answer tokens (keeps CPU latency bounded)
NUM_CTX = 2048
RRF_K = 60
