"""Run before every demo / rehearsal:  python backend/preflight.py
Checks everything the app needs with Wi-Fi OFF."""
import config  # noqa: F401

import sys

import requests

ok_all = True


def check(label, ok, hint=""):
    global ok_all
    ok_all &= bool(ok)
    print(("  OK   " if ok else "  FAIL ") + label + ("" if ok else f"   -> {hint}"))


check("E5 model on disk", config.MODEL_DIR.exists(), "python backend/download_models.py (needs internet)")
try:
    tags = requests.get(f"{config.OLLAMA_URL}/api/tags", timeout=3).json().get("models", [])
    check("Ollama running", True)
    names = [m["name"].split(":")[0] for m in tags]
    check(f"Ollama model '{config.OLLAMA_MODEL}' created", config.OLLAMA_MODEL in names,
          "ollama create bhasha-hindi -f backend/Modelfile")
except Exception:
    check("Ollama running", False, "start the Ollama app / run `ollama serve`")
check("TK-D PDF present", (config.PACKS_DIR / "tk-d" / "chapter.pdf").exists(),
      "copy the official PDF to content-packs/tk-d/chapter.pdf")
check("Frontend built (optional)", config.FRONTEND_DIST.exists(), "cd frontend && npm run build")
try:
    requests.get("https://example.com", timeout=2)
    print("  NOTE internet is currently ON (turn Wi-Fi off for the real rehearsal)")
except Exception:
    print("  NOTE internet is OFF - good, this is the judging condition")
sys.exit(0 if ok_all else 1)
