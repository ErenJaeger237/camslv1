"""
db_users.py — user accounts stored in backend/data/users.db.

Uses only stdlib (hashlib, sqlite3, secrets) — no extra packages needed.
Password hashing: PBKDF2-HMAC-SHA256, 260 000 iterations.
Tokens: random 32-byte hex strings stored in the sessions table.
"""

import hashlib
import secrets
import sqlite3
import time
import re
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "users.db"


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    return con


def init() -> None:
    with _conn() as con:
        con.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id       TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                pw_hash  TEXT NOT NULL,
                created  REAL NOT NULL
            )
        """)
        con.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token    TEXT PRIMARY KEY,
                user_id  TEXT NOT NULL,
                username TEXT NOT NULL,
                created  REAL NOT NULL
            )
        """)


def _hash(password: str, salt: str) -> str:
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return key.hex()


def register(username: str, password: str) -> dict:
    """Create a new user. Returns {token, username} or raises ValueError."""
    if len(username) < 2 or len(username) > 32:
        raise ValueError("Username must be 2–32 characters.")
    if not re.match(r"^[a-zA-Z0-9_]+$", username):
        raise ValueError("Username can only contain letters, numbers, and underscores.")
    if len(password) < 6:
        raise ValueError("Password must be at least 6 characters.")
    if len(password) > 100:
        raise ValueError("Password must be less than 100 characters.")

    salt = secrets.token_hex(16)
    pw_hash = f"{salt}:{_hash(password, salt)}"
    user_id = secrets.token_hex(16)

    try:
        with _conn() as con:
            con.execute(
                "INSERT INTO users (id, username, pw_hash, created) VALUES (?,?,?,?)",
                (user_id, username, pw_hash, time.time()),
            )
    except sqlite3.IntegrityError:
        raise ValueError("Username already taken.")

    return _make_session(user_id, username)


def login(username: str, password: str) -> dict:
    """Verify credentials. Returns {token, username, user_id} or raises ValueError."""
    with _conn() as con:
        row = con.execute(
            "SELECT id, pw_hash FROM users WHERE username=?", (username,)
        ).fetchone()
    if row is None:
        raise ValueError("Invalid username or password.")

    salt, stored = row["pw_hash"].split(":", 1)
    if _hash(password, salt) != stored:
        raise ValueError("Invalid username or password.")

    return _make_session(row["id"], username)


def _make_session(user_id: str, username: str) -> dict:
    token = secrets.token_hex(32)
    with _conn() as con:
        # Remove expired sessions (older than 30 days) to prevent database bloat
        expiry_seconds = 30 * 24 * 60 * 60
        con.execute("DELETE FROM sessions WHERE user_id=? AND ? - created > ?", (user_id, time.time(), expiry_seconds))
        con.execute(
            "INSERT INTO sessions (token, user_id, username, created) VALUES (?,?,?,?)",
            (token, user_id, username, time.time()),
        )
    return {"token": token, "username": username, "user_id": user_id}


def verify_token(token: str) -> dict | None:
    """Return {user_id, username} for a valid token, else None."""
    with _conn() as con:
        row = con.execute(
            "SELECT user_id, username, created FROM sessions WHERE token=?", (token,)
        ).fetchone()
        
        if not row:
            return None
            
        # Check if session is older than 30 days
        if time.time() - row["created"] > 30 * 24 * 60 * 60:
            con.execute("DELETE FROM sessions WHERE token=?", (token,))
            return None
            
    return {"user_id": row["user_id"], "username": row["username"]}
