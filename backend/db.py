import random
import time
import os
import psycopg2
import psycopg2.extras

BOX_INTERVALS = {1: 0, 2: 3_600, 3: 86_400, 4: 259_200, 5: 604_800}
ALPHABET_LABELS = list("ABCDEFGHIKLMNOPQRSTUVWXY")

def _conn():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise ValueError("DATABASE_URL environment variable is missing")
    con = psycopg2.connect(db_url)
    con.autocommit = True
    return con

def init_session(session_id: str) -> None:
    with _conn() as con:
        with con.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS leitner_stats (
                    session_id       TEXT NOT NULL,
                    letter           TEXT NOT NULL,
                    box              INTEGER DEFAULT 1,
                    next_review      INTEGER DEFAULT 0,
                    total_attempts   INTEGER DEFAULT 0,
                    correct_attempts INTEGER DEFAULT 0,
                    PRIMARY KEY (session_id, letter)
                )
            """)
            
            cur.execute("SELECT 1 FROM leitner_stats WHERE session_id=%s LIMIT 1", (session_id,))
            if cur.fetchone():
                return
                
            args = [(session_id, l) for l in ALPHABET_LABELS]
            psycopg2.extras.execute_values(
                cur,
                "INSERT INTO leitner_stats (session_id, letter) VALUES %s ON CONFLICT DO NOTHING",
                args
            )

def select_next_letter(session_id: str, recent: list[str]) -> str:
    init_session(session_id)
    now = int(time.time())
    try:
        with _conn() as con:
            with con.cursor() as cur:
                cur.execute(
                    "SELECT letter FROM leitner_stats WHERE session_id=%s AND next_review <= %s ORDER BY box ASC",
                    (session_id, now,)
                )
                due = [r[0] for r in cur.fetchall()]
                valid = [l for l in due if l not in recent]
                if valid:
                    return random.choice(valid)
                
                cur.execute("SELECT MIN(box) FROM leitner_stats WHERE session_id=%s", (session_id,))
                min_box = cur.fetchone()[0] or 1
                
                cur.execute(
                    "SELECT letter FROM leitner_stats WHERE session_id=%s AND box = %s",
                    (session_id, min_box)
                )
                candidates = [r[0] for r in cur.fetchall()]
                filtered = [l for l in candidates if l not in recent] or candidates or ALPHABET_LABELS
                return random.choice(filtered)
    except Exception as e:
        print(f"[DB] select_next_letter error: {e}")
        return random.choice([l for l in ALPHABET_LABELS if l not in recent] or ALPHABET_LABELS)

def update_leitner(session_id: str, letter: str, correct: bool) -> None:
    init_session(session_id)
    try:
        with _conn() as con:
            with con.cursor() as cur:
                cur.execute(
                    "SELECT box, total_attempts, correct_attempts FROM leitner_stats WHERE session_id=%s AND letter=%s",
                    (session_id, letter),
                )
                row = cur.fetchone()
                box, total, correct_cnt = row if row else (1, 0, 0)
                total += 1
                if correct:
                    correct_cnt += 1
                    new_box = min(5, box + 1)
                else:
                    new_box = 1
                next_review = int(time.time()) + BOX_INTERVALS.get(new_box, 0)
                cur.execute(
                    "UPDATE leitner_stats SET box=%s, next_review=%s, total_attempts=%s, correct_attempts=%s WHERE session_id=%s AND letter=%s",
                    (new_box, next_review, total, correct_cnt, session_id, letter),
                )
    except Exception as e:
        print(f"[DB] update error: {e}")

def overall_mastery(session_id: str) -> int:
    init_session(session_id)
    try:
        with _conn() as con:
            with con.cursor() as cur:
                cur.execute("SELECT box FROM leitner_stats WHERE session_id=%s", (session_id,))
                boxes = [r[0] for r in cur.fetchall()]
        return int(sum(max(0, b - 1) for b in boxes) / (4 * len(boxes)) * 100) if boxes else 0
    except Exception:
        return 0
