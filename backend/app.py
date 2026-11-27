"""
Mood Diary – backend.

Run from the project root (the folder that contains backend/ and frontend/):
    uvicorn backend.app:app --reload
Then open http://127.0.0.1:8000
"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import ai, db

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"


@asynccontextmanager
async def lifespan(app):
    db.init()
    ai.preload_all()
    yield


app = FastAPI(title="Mood Diary", lifespan=lifespan)


# ======================= chats (the diary) =======================
class NewChat(BaseModel):
    agent_name: str = Field("", max_length=30)
    gender: str = "female"                 # 'female' | 'male'
    personality: str = "warm"


@app.post("/api/chats")
def create_chat(req: NewChat):
    gender = "male" if req.gender == "male" else "female"
    name = req.agent_name.strip() or ("Luna" if gender == "female" else "Leo")
    personality = req.personality if req.personality in ai.PERSONALITIES else "warm"
    chat_id = db.create_chat(name, gender, personality, ai.greeting(name))
    return {"id": chat_id}


@app.get("/api/chats")
def list_chats():
    return [{k: c[k] for k in ("id", "title", "agent_name", "gender", "updated_at", "top_emotion")}
            for c in db.list_chats()]


@app.get("/api/chats/{chat_id}")
def get_chat(chat_id: int):
    chat = db.get_chat(chat_id)
    if not chat:
        raise HTTPException(404, "Chat not found")
    return {"chat": chat, "messages": db.messages(chat_id)}


class Rename(BaseModel):
    title: str = Field(..., min_length=1, max_length=80)


@app.patch("/api/chats/{chat_id}")
def rename_chat(chat_id: int, req: Rename):
    if not db.get_chat(chat_id):
        raise HTTPException(404, "Chat not found")
    db.rename_chat(chat_id, req.title.strip())
    return {"ok": True}


@app.get("/api/status")
def status():
    """Which models are loaded, still loading, or failed (with the error)."""
    return ai.STATUS


@app.delete("/api/chats/{chat_id}")
def delete_chat(chat_id: int):
    db.delete_chat(chat_id)
    return {"ok": True}


class NewMessage(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)
    source: str = "typed"                  # 'typed' | 'spoken'


@app.post("/api/chats/{chat_id}/messages")
def send_message(chat_id: int, req: NewMessage):
    """Save the user's message, then stream the companion's reply and save it when done."""
    chat = db.get_chat(chat_id)
    if not chat:
        raise HTTPException(404, "Chat not found")
    history = [{"role": m["role"], "content": m["content"]}
               for m in db.messages(chat_id, limit=ai.HISTORY_TURNS)]
    user_msg_id = db.add_message(chat_id, "user", req.text.strip(),
                                 "spoken" if req.source == "spoken" else "typed")
    prompt = ([{"role": "system", "content": ai.system_prompt(chat["agent_name"], chat["gender"], chat["personality"])}]
              + history + [{"role": "user", "content": req.text.strip()}])

    def generate():
        reply = ""
        try:
            for piece in ai.stream_reply(prompt):
                reply += piece
                yield piece
        finally:
            if reply.strip():
                db.add_message(chat_id, "assistant", reply.strip())

    return StreamingResponse(generate(), media_type="text/plain; charset=utf-8",
                             headers={"X-User-Message-Id": str(user_msg_id)})


class Emotions(BaseModel):
    emotions: dict[str, float]


@app.patch("/api/messages/{message_id}/emotions")
def save_emotions(message_id: int, req: Emotions):
    db.set_emotions(message_id, ai.normalise(req.emotions))
    return {"ok": True}


# ======================= speech & emotion =======================
class TextIn(BaseModel):
    text: str


@app.post("/api/emotion")
def emotion_from_text(req: TextIn):
    p = ai.safe(ai.text_emotion, req.text)
    if p is None:
        return JSONResponse(status_code=500, content={"error": "text emotion model failed, see terminal"})
    return {"emotions": p}


@app.post("/api/transcribe")
def transcribe(audio: UploadFile = File(...)):
    try:
        audio_np = ai.decode_audio_bytes(audio.file.read())
        text = ai.transcribe(audio_np)
        print(f"Transcript ({len(audio_np) / 16000:.1f}s):", text, flush=True)
        return {"text": text}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"error": f"{type(e).__name__}: {e}"})


@app.post("/api/voice-emotion")
def voice_emotion(audio: UploadFile = File(...)):
    p = ai.safe(lambda: ai.voice_emotion(ai.decode_audio_bytes(audio.file.read())))
    return {"emotions": p}


# ======================= dashboard =======================
NEGATIVE = ("sad", "angry", "fearful", "disgusted")


def negativity(e: dict) -> float:
    return sum(e.get(k, 0) for k in NEGATIVE)


@app.get("/api/dashboard")
def dashboard(days: int = 7):
    """days = 7 (this week), 30 (month) or 0 (all time)."""
    chats = db.list_chats(days or None)
    scored = [c for c in chats if c["mix"]]
    overall = db.average([e for c in chats for e in c["timeline"]])

    most_felt = None
    if overall:                                  # ignore neutral: show the strongest real feeling
        k = max((e for e in ai.EMOTIONS if e != "neutral"), key=lambda e: overall[e])
        most_felt = {"emotion": k, "share": overall[k]}

    brightest = None
    if scored:
        b = max(scored, key=lambda c: c["mix"]["happy"])
        brightest = {"id": b["id"], "title": b["title"], "happy": b["mix"]["happy"]}

    moments, compared, lighter = [], 0, 0
    for c in scored:
        if len(c["timeline"]) < 2:
            continue
        compared += 1
        first, last = negativity(c["timeline"][0]), negativity(c["timeline"][-1])
        if last < first:
            lighter += 1
        if abs(first - last) >= 0.15:
            moments.append({
                "kind": "lifted" if last < first else "heavier",
                "chat_id": c["id"], "title": c["title"],
                "from": round(first, 2), "to": round(last, 2),
            })
    moments.sort(key=lambda m: abs(m["from"] - m["to"]), reverse=True)

    return {
        "kpis": {
            "chats": len(chats),
            "messages_scored": sum(len(c["timeline"]) for c in chats),
            "most_felt": most_felt,
            "brightest": brightest,
            "lighter": {"count": lighter, "of": compared},
        },
        "overall": overall,
        "chats": [{k: c[k] for k in ("id", "title", "agent_name", "updated_at", "mix", "top_emotion")}
                  for c in scored],
        "moments": moments[:4],
    }


# ======================= frontend =======================
app.mount("/static", StaticFiles(directory=FRONTEND), name="static")


@app.get("/")
def index():
    return FileResponse(FRONTEND / "index.html")
