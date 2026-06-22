"""
database.py — Spaced repetition persistence layer.

Encapsulates all SQLite access for the Leitner-box practice system.
Keeping database logic separate from the API/webcam layer lets each
component be tested and changed independently.

Schema
------
  leitner_stats
    letter          TEXT PRIMARY KEY
    box             INTEGER   1–5  (Leitner box level)
    next_review     INTEGER   Unix timestamp of next due date
    total_attempts  INTEGER
    correct_attempts INTEGER

Leitner review intervals
  Box 1 → immediate  (0 s)
  Box 2 → 1 hour     (3 600 s)
  Box 3 → 1 day      (86 400 s)
  Box 4 → 3 days     (259 200 s)
  Box 5 → 7 days     (604 800 s)
"""

import random
import sqlite3
import time
from pathlib import Path


BOX_INTERVALS = {1: 0, 2: 3_600, 3: 86_400, 4: 259_200, 5: 604_800}


class LeitnerDB:
    """
    Thread-safe SQLite wrapper for the Leitner spaced-repetition system.

    Each public method opens and closes its own connection so the object
    can be shared across threads without holding a long-lived connection
    (which causes 'database is locked' errors under concurrent writes).
    """

    def __init__(self, db_path: Path, labels: list[str]):
        self._path   = db_path
        self._labels = labels
        self._path.parent.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._path), timeout=5)
        conn.execute("PRAGMA journal_mode=WAL")   # allows concurrent readers
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_review_box ON leitner_stats(next_review, box)"
        )
        return conn

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def init(self) -> None:
        """Create schema and seed rows for every label if they don't exist."""
        with self._connect() as conn:
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
                [(ltr,) for ltr in self._labels],
            )
            conn.commit()

    def select_next_letter(self, recent: list[str]) -> str:
        """
        Choose the next letter to practise using a two-priority queue:
          1. Letters that are due (next_review <= now), lowest box first.
          2. Fallback: the letter with the lowest box not in recent history.

        The `recent` list prevents the same letter from appearing back-to-back.
        """
        now = int(time.time())
        try:
            with self._connect() as conn:
                due = [
                    r[0] for r in conn.execute(
                        "SELECT letter FROM leitner_stats "
                        "WHERE next_review <= ? ORDER BY box ASC, letter ASC",
                        (now,),
                    )
                ]
                valid_due = [l for l in due if l not in recent]
                if valid_due:
                    return random.choice(valid_due)

                # Fallback: lowest box not recently seen
                min_box = conn.execute("SELECT MIN(box) FROM leitner_stats").fetchone()[0] or 1
                candidates = [
                    r[0] for r in conn.execute(
                        "SELECT letter FROM leitner_stats WHERE box = ? ORDER BY letter ASC",
                        (min_box,),
                    )
                ]
                filtered = [l for l in candidates if l not in recent] or candidates or self._labels
                return random.choice(filtered)
        except Exception as e:
            print(f"[LeitnerDB] select_next_letter error: {e}")
            return random.choice([l for l in self._labels if l not in recent] or self._labels)

    def update(self, letter: str, correct: bool) -> None:
        """Advance or demote a letter's box and schedule its next review."""
        try:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT box, total_attempts, correct_attempts FROM leitner_stats WHERE letter = ?",
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
                    "UPDATE leitner_stats "
                    "SET box=?, next_review=?, total_attempts=?, correct_attempts=? "
                    "WHERE letter=?",
                    (new_box, next_review, total, correct_cnt, letter),
                )
                conn.commit()
        except Exception as e:
            print(f"[LeitnerDB] update error: {e}")

    def overall_mastery(self) -> int:
        """
        Return overall mastery as a percentage.
        Each letter contributes (box - 1) points out of a maximum of 4.
        """
        try:
            with self._connect() as conn:
                boxes = [r[0] for r in conn.execute("SELECT box FROM leitner_stats")]
            if not boxes:
                return 0
            return int(sum(max(0, b - 1) for b in boxes) / (4 * len(boxes)) * 100)
        except Exception:
            return 0
