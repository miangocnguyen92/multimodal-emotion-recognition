"""
All AI models used by the app, in one place:
  - LLM (Ollama)                 -> the companion's replies
  - faster-whisper               -> speech-to-text
  - distilroberta emotion model  -> emotion from words
  - emotion2vec+                 -> emotion from tone of voice
Every model loads once, in the background, when the server starts.
"""
import io
import threading
import traceback

import numpy as np
import ollama

# ---------------- settings you may want to change ----------------
LLM_MODEL = "llama3.2:1b"        # fastest. Others: "qwen3:1.7b", "qwen3:4b" (better but slower)
WHISPER_MODEL = "base.en"        # "tiny.en" = fastest, "small.en" = most accurate
TEXT_EMOTION_MODEL = "j-hartmann/emotion-english-distilroberta-base"
VOICE_EMOTION_MODEL = "emotion2vec/emotion2vec_plus_base"
KEEP_ALIVE = "60m"
LLM_OPTIONS = {"temperature": 0.7, "num_predict": 100, "num_ctx": 2048}
HISTORY_TURNS = 6                # how many previous messages the LLM sees
# ------------------------------------------------------------------

EMOTIONS = ["happy", "sad", "angry", "disgusted", "fearful", "neutral", "surprised"]
THINKING_MODELS = ("qwen3", "deepseek-r1", "gpt-oss", "magistral")

PERSONALITIES = {
    "warm": "a warm, patient listener who validates feelings before anything else",
    "cheerful": "cheerful and encouraging, and you gently help people see the bright side",
    "calm": "calm and wise, and you offer gentle perspective and simple, practical ideas",
    "direct": "an honest straight talker: kind, but you say clearly what you think",
}


def safe(fn, *args):
    """Run something; if it fails, print the error and return None instead of crashing."""
    try:
        return fn(*args)
    except Exception:
        traceback.print_exc()
        return None


# ======================= LLM =======================
def system_prompt(name: str, gender: str, personality: str) -> str:
    who = "a young woman" if gender == "female" else "a young man"
    trait = PERSONALITIES.get(personality, PERSONALITIES["warm"])
    return (
        f"You are {name}, {who} who is a supportive companion inside the user's private "
        f"emotional diary app. You are {trait}. The user talks to you about their day and "
        "their feelings. Listen, reflect what they feel, and ask one gentle follow-up question. "
        "Keep every reply short (1-3 sentences) and conversational, because it is spoken aloud. "
        "No emojis, no markdown, no lists. If the user mentions wanting to hurt themselves, "
        "respond with care and encourage them to reach out to someone they trust or a local "
        "crisis line."
    )


def greeting(name: str) -> str:
    return f"Hi, I'm {name}. How was your day? I'm here to listen."


def stream_reply(messages: list[dict]):
    """Yield the reply piece by piece as the LLM writes it (without any <think> text)."""
    extra = {"think": False} if LLM_MODEL.startswith(THINKING_MODELS) else {}
    stream = ollama.chat(model=LLM_MODEL, messages=messages, stream=True,
                         options=LLM_OPTIONS, keep_alive=KEEP_ALIVE, **extra)
    yield from strip_thinking(part["message"]["content"] for part in stream)


def strip_thinking(pieces):
    """Safety net: drop any <think>...</think> block so only the answer reaches the user."""
    OPEN, CLOSE = "<think>", "</think>"
    buf, in_think = "", False
    for piece in pieces:
        buf += piece
        out = ""
        while True:
            if in_think:
                i = buf.find(CLOSE)
                if i == -1:
                    buf = buf[-len(CLOSE):]
                    break
                buf, in_think = buf[i + len(CLOSE):].lstrip(), False
            else:
                i = buf.find(OPEN)
                if i == -1:
                    keep = max((k for k in range(1, len(OPEN)) if buf.endswith(OPEN[:k])), default=0)
                    out += buf[:len(buf) - keep]
                    buf = buf[len(buf) - keep:]
                    break
                out += buf[:i]
                buf, in_think = buf[i + len(OPEN):], True
        if out:
            yield out
    if buf and not in_think:
        yield buf


def warm_up_llm():
    print(f"Warming up {LLM_MODEL}...", flush=True)
    ollama.generate(model=LLM_MODEL, prompt="", keep_alive=KEEP_ALIVE)
    print(f"{LLM_MODEL} is ready.", flush=True)


# ======================= Speech-to-text =======================
_whisper, _whisper_lock = None, threading.Lock()


def get_whisper():
    global _whisper
    with _whisper_lock:
        if _whisper is None:
            print(f"Loading Whisper {WHISPER_MODEL}...", flush=True)
            from faster_whisper import WhisperModel
            _whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
            print("Whisper ready.", flush=True)
    return _whisper


def decode_audio_bytes(data: bytes, sr: int = 16000) -> np.ndarray:
    """Browser recording (webm/opus) -> mono float32 array at 16 kHz."""
    import av
    chunks = []
    with av.open(io.BytesIO(data)) as container:
        resampler = av.AudioResampler(format="s16", layout="mono", rate=sr)
        for frame in container.decode(audio=0):
            for f in resampler.resample(frame):
                chunks.append(f.to_ndarray())
        for f in resampler.resample(None):
            chunks.append(f.to_ndarray())
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks, axis=1).flatten().astype(np.float32) / 32768.0


def transcribe(audio_np: np.ndarray) -> str:
    segments, _ = get_whisper().transcribe(audio_np, language="en", beam_size=1,
                                           vad_filter=True, condition_on_previous_text=False)
    return " ".join(s.text.strip() for s in segments).strip()


# ======================= Emotion =======================
TEXT_MAP = {"joy": "happy", "sadness": "sad", "anger": "angry", "disgust": "disgusted",
            "fear": "fearful", "neutral": "neutral", "surprise": "surprised"}
_text_clf, _ser = None, None
_text_lock, _ser_lock = threading.Lock(), threading.Lock()


def get_text_clf():
    global _text_clf
    with _text_lock:
        if _text_clf is None:
            print("Loading text emotion model...", flush=True)
            from transformers import pipeline
            _text_clf = pipeline("text-classification", model=TEXT_EMOTION_MODEL, top_k=None)
            print("Text emotion model ready.", flush=True)
    return _text_clf


def get_ser():
    global _ser
    with _ser_lock:
        if _ser is None:
            print("Loading voice emotion model (emotion2vec+)...", flush=True)
            from funasr import AutoModel
            _ser = AutoModel(model=VOICE_EMOTION_MODEL, hub="hf", disable_update=True)
            print("Voice emotion model ready.", flush=True)
    return _ser


def normalise(p: dict) -> dict:
    total = sum(p.values()) or 1.0
    return {k: round(p.get(k, 0.0) / total, 4) for k in EMOTIONS}


def text_emotion(text: str) -> dict:
    res = get_text_clf()(text[:512])
    if res and isinstance(res[0], list):
        res = res[0]
    return normalise({TEXT_MAP[r["label"]]: r["score"] for r in res if r["label"] in TEXT_MAP})


def voice_emotion(audio_np: np.ndarray):
    if len(audio_np) < 16000 * 0.5:          # under half a second: too short to judge
        return None
    out = get_ser().generate(audio_np, granularity="utterance", extract_embedding=False)[0]
    p = {}
    for label, score in zip(out["labels"], out["scores"]):
        name = label.split("/")[-1]          # labels look like "开心/happy"
        if name in EMOTIONS:
            p[name] = p.get(name, 0.0) + float(score)
    return normalise(p) if p else None


# What each model is doing right now; shown in the app so problems aren't silent.
STATUS = {"llm": "waiting", "whisper": "waiting", "text_emotion": "waiting", "voice_emotion": "waiting"}


def _load(name, loader):
    STATUS[name] = "loading"
    try:
        loader()
        STATUS[name] = "ready"
    except Exception as e:
        traceback.print_exc()
        STATUS[name] = f"error: {type(e).__name__}: {e}"[:300]


def preload_all():
    """Start loading every model in the background so the first message isn't slow."""
    for name, loader in (("llm", warm_up_llm), ("text_emotion", get_text_clf),
                         ("whisper", get_whisper), ("voice_emotion", get_ser)):
        threading.Thread(target=_load, args=(name, loader), daemon=True).start()
