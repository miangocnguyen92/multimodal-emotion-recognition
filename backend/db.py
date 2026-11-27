"""
The diary: every chat and message is saved in a local SQLite file (data/diary.db).
"""
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "diary.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS chats (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL DEFAULT 'New chat',
    agent_name  TEXT NOT NULL,
    gender      TEXT NOT NULL,          -- 'female' | 'male'
    personality TEXT NOT NULL,          -- 'warm' | 'cheerful' | 'calm' | 'direct'
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id     INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,          -- 'user' | 'assistant'
    content     TEXT NOT NULL,
    source      TEXT,                   -- 'typed' | 'spoken' (user messages only)
    emotions    TEXT,                   -- JSON {"happy": 0.1, ...} (user messages only)
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);
"""


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


@contextmanager
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init():
    with connect() as con:
        con.executescript(SCHEMA)


# ---------------- chats ----------------
def create_chat(agent_name: str, gender: str, personality: str, greeting: str) -> int:
    with connect() as con:
        t = now()
        cur = con.execute(
            "INSERT INTO chats (agent_name, gender, personality, created_at, updated_at) VALUES (?,?,?,?,?)",
            (agent_name, gender, personality, t, t))
        chat_id = cur.lastrowid
        con.execute("INSERT INTO messages (chat_id, role, content, created_at) VALUES (?,?,?,?)",
                    (chat_id, "assistant", greeting, t))
        return chat_id


def get_chat(chat_id: int):
    with connect() as con:
        row = con.execute("SELECT * FROM chats WHERE id=?", (chat_id,)).fetchone()
        return dict(row) if row else None


def rename_chat(chat_id: int, title: str):
    with connect() as con:
        con.execute("UPDATE chats SET title=? WHERE id=?", (title, chat_id))


def delete_chat(chat_id: int):
    with connect() as con:
        con.execute("DELETE FROM chats WHERE id=?", (chat_id,))


def messages(chat_id: int, limit: int | None = None) -> list[dict]:
    with connect() as con:
        if limit:
            rows = con.execute("SELECT * FROM messages WHERE chat_id=? ORDER BY id DESC LIMIT ?",
                               (chat_id, limit)).fetchall()[::-1]
        else:
            rows = con.execute("SELECT * FROM messages WHERE chat_id=? ORDER BY id", (chat_id,)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["emotions"] = json.loads(d["emotions"]) if d["emotions"] else None
        out.append(d)
    return out


def add_message(chat_id: int, role: str, content: str, source: str | None = None) -> int:
    with connect() as con:
        t = now()
        cur = con.execute("INSERT INTO messages (chat_id, role, content, source, created_at) VALUES (?,?,?,?,?)",
                          (chat_id, role, content, source, t))
        con.execute("UPDATE chats SET updated_at=? WHERE id=?", (t, chat_id))
        if role == "user":   # the first thing the user says becomes the chat title
            title = content if len(content) <= 40 else content[:38].rsplit(" ", 1)[0] + "…"
            con.execute("UPDATE chats SET title=? WHERE id=? AND title='New chat'", (title, chat_id))
        return cur.lastrowid


def set_emotions(message_id: int, emotions: dict):
    with connect() as con:
        con.execute("UPDATE messages SET emotions=? WHERE id=? AND role='user'",
                    (json.dumps(emotions), message_id))


def list_chats(days: int | None = None) -> list[dict]:
    """All chats, newest first, each with its average emotion mix."""
    with connect() as con:
        if days:
            since = (datetime.now() - timedelta(days=days)).isoformat(timespec="seconds")
            rows = con.execute("SELECT * FROM chats WHERE updated_at >= ? ORDER BY updated_at DESC",
                               (since,)).fetchall()
        else:
            rows = con.execute("SELECT * FROM chats ORDER BY updated_at DESC").fetchall()
        chats = [dict(r) for r in rows]
        for c in chats:
            emo_rows = con.execute(
                "SELECT emotions FROM messages WHERE chat_id=? AND role='user' AND emotions IS NOT NULL ORDER BY id",
                (c["id"],)).fetchall()
            c["timeline"] = [json.loads(r["emotions"]) for r in emo_rows]
            c["mix"] = average(c["timeline"])
            c["top_emotion"] = max(c["mix"], key=c["mix"].get) if c["mix"] else None
    return chats


def average(dicts: list[dict]) -> dict | None:
    if not dicts:
        return None
    keys = dicts[0].keys()
    return {k: round(sum(d.get(k, 0) for d in dicts) / len(dicts), 4) for k in keys}
