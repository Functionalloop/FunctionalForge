"""Tiny Ollama client (localhost only)."""
import json

import requests

import config


class OllamaUnavailable(RuntimeError):
    pass


def build_prompt(question: str, chunks) -> str:
    # Page numbers are deliberately NOT included: the model must never see or cite them.
    context = "\n\n".join(
        f"[अंश {i + 1} | विषय: {c['topic']}]\n{c['text']}" for i, c in enumerate(chunks)
    )
    return (
        f"संदर्भ (Context):\n{context}\n\n"
        f"छात्र का प्रश्न: {question}\n\n"
        "उत्तर (केवल हिंदी में, 3-5 वाक्यों में):"
    )


def _payload(prompt: str, stream: bool) -> dict:
    return {
        "model": config.OLLAMA_MODEL,
        "prompt": prompt,
        "stream": stream,
        "keep_alive": "60m",   # keep weights in RAM for the whole demo
        "options": {
            "temperature": 0.1,
            "top_p": 0.85,
            "num_ctx": config.NUM_CTX,
            "num_predict": config.NUM_PREDICT,
        },
    }


def ollama_ready() -> bool:
    try:
        r = requests.get(f"{config.OLLAMA_URL}/api/tags", timeout=2)
        names = [m.get("name", "") for m in r.json().get("models", [])]
        return any(n.split(":")[0] == config.OLLAMA_MODEL for n in names)
    except Exception:
        return False


def generate(prompt: str) -> str:
    try:
        r = requests.post(f"{config.OLLAMA_URL}/api/generate", json=_payload(prompt, False), timeout=300)
        r.raise_for_status()
        return r.json().get("response", "").strip()
    except requests.RequestException as e:
        raise OllamaUnavailable(f"Ollama not reachable / model '{config.OLLAMA_MODEL}' missing: {e}")


def generate_stream(prompt: str):
    try:
        with requests.post(
            f"{config.OLLAMA_URL}/api/generate", json=_payload(prompt, True), stream=True, timeout=300
        ) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if not line:
                    continue
                data = json.loads(line)
                tok = data.get("response", "")
                if tok:
                    yield tok
                if data.get("done"):
                    break
    except requests.RequestException as e:
        raise OllamaUnavailable(f"Ollama not reachable / model '{config.OLLAMA_MODEL}' missing: {e}")
