"""
signs.py — Word-sign recognition endpoint.

POST /api/signs/predict   body: { sequence: [[150 floats] × 30] }
                          returns: { sign: str, confidence: float }

GET  /api/signs/labels    returns: { labels: [str] }

signs.keras is downloaded from Supabase Storage on first call and cached
in /tmp for the lifetime of the Render instance.  Subsequent calls use the
in-memory model directly (no disk I/O after first load).
"""

import json
import os
from pathlib import Path

import httpx
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

SB_URL      = os.getenv("SUPABASE_URL", "")
SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
BUCKET      = "camsl-models"

CACHE_DIR   = Path("/tmp/camsl_models")
MODEL_PATH  = CACHE_DIR / "signs.keras"
LABELS_PATH = CACHE_DIR / "signs_labels.json"

SEQUENCE_FRAMES = 30
NUM_FEATURES    = 150  # hand(63) + face(60) + pose(27), matches train_signs.py

_model        = None
_labels: list | None = None


def _sb_download(filename: str, dest: Path) -> None:
    if dest.exists():
        return
    if not SB_URL or not SERVICE_KEY:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY not configured on Render")
    url = f"{SB_URL}/storage/v1/object/{BUCKET}/{filename}"
    r = httpx.get(
        url,
        headers={"Authorization": f"Bearer {SERVICE_KEY}"},
        timeout=120,
        follow_redirects=True,
    )
    if r.status_code != 200:
        raise RuntimeError(f"Supabase download failed ({r.status_code}): {filename}")
    dest.write_bytes(r.content)


def _ensure_model() -> None:
    global _model, _labels
    if _model is not None:
        return

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _sb_download("signs.keras", MODEL_PATH)
    _sb_download("signs_labels.json", LABELS_PATH)

    import tensorflow as tf
    _model = tf.keras.models.load_model(str(MODEL_PATH))

    with open(LABELS_PATH) as f:
        _labels = json.load(f)

    # Warm-up: avoids first-predict latency spike
    dummy = np.zeros((1, SEQUENCE_FRAMES, NUM_FEATURES), dtype=np.float32)
    _model.predict(dummy, verbose=0)


class PredictRequest(BaseModel):
    sequence: list[list[float]]  # variable N × 150; we pad/trim to 30


@router.post("/signs/predict")
def predict_sign(body: PredictRequest):
    try:
        _ensure_model()
    except Exception as e:
        raise HTTPException(503, f"Signs model unavailable: {e}")

    seq = np.array(body.sequence, dtype=np.float32)
    if seq.ndim != 2 or seq.shape[1] != NUM_FEATURES:
        raise HTTPException(400, f"Each frame must have {NUM_FEATURES} features, got shape {seq.shape}")

    # Pad short sequences with zeros; truncate long ones to SEQUENCE_FRAMES
    if seq.shape[0] < SEQUENCE_FRAMES:
        pad = np.zeros((SEQUENCE_FRAMES - seq.shape[0], NUM_FEATURES), dtype=np.float32)
        seq = np.vstack([seq, pad])
    seq = seq[:SEQUENCE_FRAMES]

    probs = _model.predict(seq[np.newaxis], verbose=0)[0]
    idx   = int(np.argmax(probs))

    return {
        "sign":       _labels[idx],
        "confidence": float(probs[idx]),
    }


@router.get("/signs/labels")
def get_labels():
    try:
        _ensure_model()
    except Exception as e:
        raise HTTPException(503, f"Signs model unavailable: {e}")
    return {"labels": _labels}
