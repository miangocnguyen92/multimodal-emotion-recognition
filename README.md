# Mood Diary: Multimodal Emotion Recognition with a Local LLM Companion

A private, voice-enabled diary app. You talk (or type) to an AI companion about your day, and the app **recognizes your emotions from both your words and your tone of voice**, then tracks how your mood changes over time on an interactive dashboard.

**Everything runs locally**: no cloud APIs, and your diary never leaves your computer.

<img width="1896" height="940" alt="screenshot" src="https://github.com/user-attachments/assets/309247dc-69b3-42da-a08b-74955daf89bb" />

<img width="1916" height="965" alt="screenshot1" src="https://github.com/user-attachments/assets/116fabd5-efba-4355-a913-61c1dca58f20" />

---

## Features

- **Multimodal emotion recognition**: combines two models into one prediction:
  - 🗣️ **Tone of voice**: `emotion2vec+` analyzes the audio itself
  - 📝 **Words**: a fine-tuned DistilRoBERTa model classifies the transcript
  - Late fusion: **60% voice + 40% text** in speaking mode, text-only in writing mode
- **7 emotion classes**: happy, sad, angry, fearful, disgusted, surprised, neutral
- **Speech-to-text** with `faster-whisper`, running on CPU (int8)
- **AI companion** powered by a local LLM (Ollama, `llama3.2:1b` by default)
  - Choose gender, name, and personality (warm, cheerful, calm, direct)
  - Replies **stream** in real time and are **spoken aloud**, synced with an animated avatar
- **Emotion dashboard**
  - Emotion trend line, message by message, within each chat
  - Emotion mix per chat (stacked bar chart)
  - KPIs: most-felt emotion, brightest chat, and whether you felt *lighter* after talking
  - "Moments": chats where difficult feelings rose or dropped by 15 points or more
- **Persistent diary** in SQLite, with search, rename, and delete

---

## Architecture

```
 Browser (HTML/CSS/JS)                     FastAPI backend (Python)
 ─────────────────────                     ────────────────────────
 🎤 Record audio  ───────────────────────►  /api/transcribe     → faster-whisper
                  ───────────────────────►  /api/voice-emotion  → emotion2vec+
 📝 Transcript    ───────────────────────►  /api/emotion        → DistilRoBERTa
 ⚖️ Fuse 60/40 voice + text
 💬 Send message  ───────────────────────►  /api/chats/{id}/messages → Ollama LLM (streamed)
 🔊 Speak reply (Web Speech API)
 📊 Dashboard     ◄───────────────────────  /api/dashboard      → SQLite (data/diary.db)
```

All models are **preloaded in background threads** at startup, and a `/api/status` endpoint shows each model's state in the UI, so failures are never silent.

---

## Models

| Task | Model |
|---|---|
| Companion replies | [Llama 3.2 1B](https://ollama.com/library/llama3.2) via Ollama (swappable, e.g. `qwen3:4b`) |
| Speech-to-text | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) `base.en` |
| Emotion from text | [j-hartmann/emotion-english-distilroberta-base](https://huggingface.co/j-hartmann/emotion-english-distilroberta-base) |
| Emotion from voice | [emotion2vec/emotion2vec_plus_base](https://huggingface.co/emotion2vec/emotion2vec_plus_base) |

---

## Project Structure

```
├── backend/
│   ├── app.py        # FastAPI routes: chats, messages, speech, emotion, dashboard
│   ├── ai.py         # All AI models: LLM, Whisper, text and voice emotion
│   └── db.py         # SQLite storage for chats, messages, and emotion scores
├── frontend/
│   ├── index.html    # Chat, new-chat setup, and dashboard views
│   ├── style.css
│   └── app.js        # Recording, streaming, voice playback, emotion fusion, charts
├── data/             # Created automatically (diary.db, git-ignored)
└── requirements.txt
```

---

## Getting Started

### 1. Prerequisites
- Python 3.10+
- [Ollama](https://ollama.com/download) installed and running

### 2. Install
```bash
git clone https://github.com/<your-username>/multimodal-emotion-recognition.git
cd multimodal-emotion-recognition

python -m venv venv
venv\Scripts\activate            # Windows
# source venv/bin/activate       # macOS / Linux

pip install -r requirements.txt
ollama pull llama3.2:1b
```

### 3. Run
From the project root:
```bash
uvicorn backend.app:app --reload
```
Open **http://127.0.0.1:8000** in Chrome or Edge, and allow microphone access.

> The first launch downloads the Whisper and emotion models from Hugging Face, which takes a few minutes. After that, everything works offline.

### 4. Configuration
Edit the settings at the top of `backend/ai.py`:

```python
LLM_MODEL = "llama3.2:1b"   # or "qwen3:4b" for better replies (slower)
WHISPER_MODEL = "base.en"   # "tiny.en" = fastest, "small.en" = most accurate
HISTORY_TURNS = 6           # how many past messages the LLM sees
```

---

## API Overview

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chats` | Create a chat (companion name, gender, personality) |
| `GET` | `/api/chats` | List chats with their top emotion |
| `POST` | `/api/chats/{id}/messages` | Send a message and stream the reply |
| `POST` | `/api/transcribe` | Audio → text |
| `POST` | `/api/voice-emotion` | Audio → emotion probabilities |
| `POST` | `/api/emotion` | Text → emotion probabilities |
| `GET` | `/api/dashboard?days=7` | Dashboard data (7, 30, or 0 = all time) |
| `GET` | `/api/status` | Loading state of each model |

---

## Limitations

- English only (the Whisper and text-emotion models are English-specific).
- The emotion models detect *expressed* emotion and are not a clinical or diagnostic tool.
- The fusion weights (60/40) are a fixed heuristic, not learned.

## Future Work

- Learn the fusion weights from labeled data
- Vietnamese language support
- Weekly mood summaries written by the LLM
- Higher-quality local text-to-speech

---

## Tech Stack

**AI/ML:** Ollama · faster-whisper · Hugging Face Transformers · FunASR (emotion2vec+)
**Backend:** FastAPI · SQLite · PyAV · NumPy
**Frontend:** Vanilla JavaScript · Chart.js · Web Speech API · MediaRecorder API

## Author

**Mia Nguyen**: [GitHub](https://github.com/miangocnguyen92) · [LinkedIn](https://www.linkedin.com/in/mianguyen92/) · [Portfolio](https://mia-nguyen-portfolio.lovable.app/)
