import hashlib
import secrets
import time
import re
import os
import psycopg2
from psycopg2.extras import DictCursor


def _conn():
    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        raise ValueError("DATABASE_URL environment variable is missing")
    con = psycopg2.connect(db_url, cursor_factory=DictCursor, connect_timeout=10)
    con.autocommit = True
    return con


def init() -> None:
    con = _conn()
    try:
        with con.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id       TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    pw_hash  TEXT NOT NULL,
                    created  REAL NOT NULL
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    token    TEXT PRIMARY KEY,
                    user_id  TEXT NOT NULL,
                    username TEXT NOT NULL,
                    created  REAL NOT NULL
                )
            """)
    finally:
        con.close()


def _hash(password: str, salt: str) -> str:
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260_000)
    return key.hex()


def register(username: str, password: str) -> dict:
    if len(username) < 2 or len(username) > 32:
        raise ValueError("Username must be 2-32 characters.")
    if not re.match(r"^[a-zA-Z0-9_]+$", username):
        raise ValueError("Username can only contain letters, numbers, and underscores.")
    if len(password) < 6:
        raise ValueError("Password must be at least 6 characters.")
    if len(password) > 100:
        raise ValueError("Password must be less than 100 characters.")

    # Normalise to lowercase so "Jordan" and "jordan" are treated as the same account
    username = username.lower()

    salt = secrets.token_hex(16)
    pw_hash = f"{salt}:{_hash(password, salt)}"
    user_id = secrets.token_hex(16)

    con = _conn()
    try:
        with con.cursor() as cur:
            cur.execute(
                "INSERT INTO users (id, username, pw_hash, created) VALUES (%s,%s,%s,%s)",
                (user_id, username, pw_hash, time.time()),
            )
    except psycopg2.IntegrityError:
        raise ValueError("Username already taken.")
    finally:
        con.close()

    return _make_session(user_id, username)


def login(username: str, password: str) -> dict:
    # Case-insensitive lookup so "Jordan" finds the stored "jordan" row
    con = _conn()
    try:
        with con.cursor() as cur:
            cur.execute(
                "SELECT id, username, pw_hash FROM users WHERE LOWER(username)=LOWER(%s)",
                (username,),
            )
            row = cur.fetchone()
            row = dict(row) if row else None  # materialise before connection closes
    finally:
        con.close()

    if row is None:
        raise ValueError("Invalid username or password.")

    salt, stored = row["pw_hash"].split(":", 1)
    if _hash(password, salt) != stored:
        raise ValueError("Invalid username or password.")

    return _make_session(row["id"], row["username"])


def _make_session(user_id: str, username: str) -> dict:
    token = secrets.token_hex(32)
    expiry_seconds = 30 * 24 * 60 * 60
    con = _conn()
    try:
        with con.cursor() as cur:
            cur.execute(
                "DELETE FROM sessions WHERE user_id=%s AND %s - created > %s",
                (user_id, time.time(), expiry_seconds),
            )
            cur.execute(
                "INSERT INTO sessions (token, user_id, username, created) VALUES (%s,%s,%s,%s)",
                (token, user_id, username, time.time()),
            )
    finally:
        con.close()

    return {"token": token, "username": username, "user_id": user_id}


def verify_token(token: str) -> dict | None:
    con = _conn()
    try:
        with con.cursor() as cur:
            cur.execute(
                "SELECT user_id, username, created FROM sessions WHERE token=%s",
                (token,),
            )
            row = cur.fetchone()
            row = dict(row) if row else None  # materialise before connection closes
    finally:
        con.close()

    if not row:
        return None

    if time.time() - row["created"] > 30 * 24 * 60 * 60:
        # Expired — clean up asynchronously
        _delete_session(token)
        return None

    return {"user_id": row["user_id"], "username": row["username"]}


def _delete_session(token: str) -> None:
    con = _conn()
    try:
        with con.cursor() as cur:
            cur.execute("DELETE FROM sessions WHERE token=%s", (token,))
    finally:
        con.close()
