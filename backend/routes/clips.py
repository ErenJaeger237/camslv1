"""
clips.py — Video clip upload and stats for the CamSL community dataset.

POST /api/clips/upload   multipart: video (WebM) + metadata (JSON string)
GET  /api/clips/stats    clip counts grouped by sign_name from Supabase
"""

import json
import os
import uuid
from datetime import datetime, timezone

import httpx
import psycopg2
from fastapi import APIRouter, HTTPException, UploadFile, File, Form

router = APIRouter()

SB_URL      = os.getenv("SUPABASE_URL", "")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
DB_URL      = os.getenv("DATABASE_URL", "")

BUCKET_VIDEO = "camsl-videos"
BUCKET_LM    = "camsl-landmarks"
TABLE        = "camsl_clips"

VALID_ALPHABET   = set("ABCDEFGHIKLMNOPQRSTUVWXY")
VALID_WORD_SIGNS = {
    "bad", "drink", "eat", "friend", "good", "goodbye",
    "hello", "help", "name", "no", "please", "school",
    "sick", "sorry", "thank_you", "water", "yes",
}


def _sb_upload(path: str, data: bytes, content_type: str) -> str:
    """Upload bytes to Supabase Storage and return the public URL."""
    if not SB_URL or not SERVICE_KEY:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY not configured")
    upload_url = f"{SB_URL}/storage/v1/object/{BUCKET_VIDEO}/{path}"
    resp = httpx.post(
        upload_url,
        content=data,
        headers={
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": content_type,
            "x-upsert": "false",
        },
        timeout=30,
    )
    if resp.status_code not in (200, 201):
        raise RuntimeError(f"Supabase Storage upload failed: {resp.status_code} {resp.text[:200]}")
    return f"{SB_URL}/storage/v1/object/public/{BUCKET_VIDEO}/{path}"


def _db_insert(row: dict) -> None:
    """Insert a clip metadata row into camsl_clips via psycopg2."""
    if not DB_URL:
        raise RuntimeError("DATABASE_URL not configured")
    conn = psycopg2.connect(DB_URL, connect_timeout=10)
    conn.autocommit = True
    try:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO camsl_clips
                (sign_name, sign_category, meaning, contributor_name,
                 contributor_id, recorded_at, video_url, frame_count, fps, duration_s)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                row["sign_name"], row["sign_category"], row["meaning"],
                row["contributor_name"], row["contributor_id"],
                row["recorded_at"], row["video_url"],
                row["frame_count"], row["fps"], row["duration_s"],
            ),
        )
        cur.close()
    finally:
        conn.close()


def _db_stats() -> dict:
    """Return {sign_name: count} from camsl_clips."""
    if not DB_URL:
        return {}
    conn = psycopg2.connect(DB_URL, connect_timeout=10)
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT sign_name, COUNT(*) FROM camsl_clips GROUP BY sign_name ORDER BY sign_name;"
        )
        return {row[0]: row[1] for row in cur.fetchall()}
    except Exception:
        return {}
    finally:
        conn.close()


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/clips/upload")
async def upload_clip(
    video:    UploadFile = File(...),
    metadata: str        = Form(...),
):
    """
    Receive a WebM video clip + JSON metadata from the browser, upload to
    Supabase Storage, and insert a row in camsl_clips.
    """
    try:
        meta = json.loads(metadata)
    except Exception:
        raise HTTPException(400, "metadata must be valid JSON")

    sign_name        = str(meta.get("sign_name", "")).strip().lower()
    category         = str(meta.get("category", "")).strip()
    meaning          = str(meta.get("meaning", sign_name)).strip()
    contributor_name = str(meta.get("contributor_name", "")).strip()
    contributor_id   = str(meta.get("contributor_id", uuid.uuid4().hex)).strip()
    frame_count      = int(meta.get("frame_count", 0))
    fps              = float(meta.get("fps", 30.0))
    duration_s       = round(frame_count / max(fps, 1), 2)

    # Validate
    if category == "alphabet":
        if sign_name.upper() not in VALID_ALPHABET:
            raise HTTPException(400, f"Unknown alphabet sign: {sign_name}")
        sign_name = sign_name.upper()
    elif category == "word_signs":
        if sign_name not in VALID_WORD_SIGNS:
            raise HTTPException(400, f"Unknown word sign: {sign_name}")
    else:
        raise HTTPException(400, "category must be 'alphabet' or 'word_signs'")

    video_data = await video.read()
    if len(video_data) < 100:
        raise HTTPException(400, "Video too small — recording may have failed")

    clip_id    = uuid.uuid4().hex[:12]
    ts         = datetime.now().strftime("%Y%m%d_%H%M%S")
    ext        = "webm"
    storage_path = f"{category}/{sign_name}/{ts}_{clip_id}.{ext}"

    try:
        video_url = _sb_upload(storage_path, video_data, video.content_type or "video/webm")
    except RuntimeError as e:
        raise HTTPException(503, f"Storage upload failed: {e}")

    row = {
        "sign_name":        sign_name,
        "sign_category":    category,
        "meaning":          meaning or sign_name,
        "contributor_name": contributor_name,
        "contributor_id":   contributor_id,
        "recorded_at":      datetime.now(timezone.utc).isoformat(),
        "video_url":        video_url,
        "frame_count":      frame_count,
        "fps":              fps,
        "duration_s":       duration_s,
    }

    try:
        _db_insert(row)
    except Exception as e:
        # Don't fail the whole request if DB insert fails — video is already saved
        return {"ok": True, "video_url": video_url, "db_warning": str(e)}

    return {"ok": True, "video_url": video_url, "clip_id": clip_id}


@router.get("/clips/stats")
def clip_stats():
    """Return clip counts from Supabase, grouped by sign name."""
    try:
        counts = _db_stats()
        return {"counts": counts, "total": sum(counts.values())}
    except Exception as e:
        raise HTTPException(503, f"Could not fetch stats: {e}")
