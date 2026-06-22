"""
db.py — database access for the FastAPI backend.
Reuses the LeitnerDB logic from src/database.py, adapted for multi-user
sessions via a session_id string (passed from the browser's localStorage).
"""

import random
import sqlite3
import time
from pathlib import Path

BOX_INTERVALS = {1: 0, 2: 3_600, 3: 86_400, 4: 259_200, 5: 604_800}
ALPHABET_LABELS = list("ABCDEFGHIKLMNOPQRSTUVWXY")  # 24 letters, no J/Z
DB_DIR = Path(__file__).parent / "data"


def _db_path(session_id: str) -> Path:
    """One SQLite file per session (anonymous user)."""
    DB_DIR.mkdir(parents=True, exist_ok=True)
    safe = "".join(c for c in session_id if c.isalnum() or c in "-_")[:64]
    return DB_DIR / f"leitner_{safe or 'default'}.db"


def _connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(path), timeout=5)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_session(session_id: str) -> None:
    path = _db_path(session_id)
    with _connect(path) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS leitner_stats (
                letter           TEXT PRIMARY KEY,
                box              INTEGER DEFAULT 1,
                next_review      INTEGER DEFAULT 0,
                total_attempts   INTEGER DEFAULT 0,
                correct_attempts INTEGER DEFAULT 0
            )
        """)
        conn.executemany(
            "INSERT OR IGNORE INTO leitner_stats (letter) VALUES (?)",
            [(l,) for l in ALPHABET_LABELS],
        )
        conn.commit()


def select_next_letter(session_id: str, recent: list[str]) -> str:
    path = _db_path(session_id)
    init_session(session_id)
    now = int(time.time())
    try:
        with _connect(path) as conn:
            due = [r[0] for r in conn.execute(
                "SELECT letter FROM leitner_stats WHERE next_review <= ? ORDER BY box ASC",
                (now,),
            )]
            valid = [l for l in due if l not in recent]
            if valid:
                return random.choice(valid)
            min_box = conn.execute("SELECT MIN(box) FROM leitner_stats").fetchone()[0] or 1
            candidates = [r[0] for r in conn.execute(
                "SELECT letter FROM leitner_stats WHERE box = ?", (min_box,)
            )]
            filtered = [l for l in candidates if l not in recent] or candidates or ALPHABET_LABELS
            return random.choice(filtered)
    except Exception as e:
        print(f"[DB] select_next_letter error: {e}")
        return random.choice([l for l in ALPHABET_LABELS if l not in recent] or ALPHABET_LABELS)


def update_leitner(session_id: str, letter: str, correct: bool) -> None:
    path = _db_path(session_id)
    init_session(session_id)
    try:
        with _connect(path) as conn:
            row = conn.execute(
                "SELECT box, total_attempts, correct_attempts FROM leitner_stats WHERE letter=?",
                (letter,),
            ).fetchone()
            box, total, correct_cnt = row if row else (1, 0, 0)
            total += 1
            if correct:
                correct_cnt += 1
                new_box = min(5, box + 1)
            else:
                new_box = 1
            next_review = int(time.time()) + BOX_INTERVALS.get(new_box, 0)
            conn.execute(
                "UPDATE leitner_stats SET box=?,next_review=?,total_attempts=?,correct_attempts=? WHERE letter=?",
                (new_box, next_review, total, correct_cnt, letter),
            )
            conn.commit()
    except Exception as e:
        print(f"[DB] update error: {e}")


def overall_mastery(session_id: str) -> int:
    path = _db_path(session_id)
    init_session(session_id)
    try:
        with _connect(path) as conn:
            boxes = [r[0] for r in conn.execute("SELECT box FROM leitner_stats")]
        return int(sum(max(0, b - 1) for b in boxes) / (4 * len(boxes)) * 100) if boxes else 0
    except Exception:
        return 0
