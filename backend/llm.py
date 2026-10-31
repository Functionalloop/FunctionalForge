"""Tiny Ollama client (localhost only)."""
import json

import requests

import config


class OllamaUnavailable(RuntimeError):
    pass


LANGUAGE_NAMES = {
    "en": "English",
    "hi": "Hindi (हिंदी)",
    "es": "Spanish (Español)",
    "fr": "French (Français)",
    "de": "German (Deutsch)",
    "bn": "Bengali (বাংলা)",
    "mr": "Marathi (मराठी)",
    "ta": "Tamil (தமிழ்)",
    "te": "Telugu (తెలుగు)",
    "gu": "Gujarati (ગુજરાતી)",
    "kn": "Kannada (ಕನ್ನಡ)",
    "ml": "Malayalam (മലയാളം)",
    "pa": "Punjabi (ਪੰਜਾਬੀ)",
    "ur": "Urdu (اردو)",
    "ar": "Arabic (العربية)",
    "ja": "Japanese (日本語)",
    "zh": "Chinese (中文)",
    "ru": "Russian (Русский)",
}


def build_prompt(question: str, chunks, language: str = "en") -> str:
    # Page numbers are deliberately NOT included: the model must never see or cite them.
    context = "\n\n".join(
        f"[Passage {i + 1} | Section: {c.get('topic', '')}]\n{c['text']}" for i, c in enumerate(chunks)
    )
    lang_name = LANGUAGE_NAMES.get(language, language)
    if language == "hi":
        return (
            f"संदर्भ (Context):\n{context}\n\n"
            f"छात्र का प्रश्न: {question}\n\n"
            f"निर्देश: केवल दिए गए संदर्भ के आधार पर उत्तर दें। उत्तर स्पष्ट रूप से हिंदी में (3-5 वाक्यों में) दें। "
            f"यदि जानकारी संदर्भ में नहीं है, तो कहें 'इस दस्तावेज़ में यह जानकारी उपलब्ध नहीं है।'\n\n"
            f"उत्तर:"
        )
    return (
        f"Context:\n{context}\n\n"
        f"Question: {question}\n\n"
        f"Instructions: Answer accurately based ONLY on the context provided above. "
        f"Respond entirely in {lang_name} in 3 to 5 clear sentences. "
        f"If the information is not found in the context, state that the information is not available in this document.\n\n"
        f"Answer in {lang_name}:"
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
