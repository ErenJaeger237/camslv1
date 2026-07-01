"""
signs.py — Word-sign recognition endpoint.

POST /api/signs/predict   body: { sequence: [[150 floats] × N] }
                          returns: { sign: str, confidence: float }

GET  /api/signs/labels    returns: { labels: [str] }

Model files are committed to the repo (models/signs.onnx, models/signs_labels.json)
and loaded from disk on first request — no Supabase download needed.
"""

import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

# Paths relative to repo root (backend/routes/ → backend/ → root/)
_ROOT        = Path(__file__).resolve().parents[2]
MODEL_PATH   = _ROOT / "models" / "signs.onnx"
LABELS_PATH  = _ROOT / "models" / "signs_labels.json"

SEQUENCE_FRAMES = 30
NUM_FEATURES    = 150   # hand(63) + face(60) + pose(27)

_session: ort.InferenceSession | None = None
_labels: list | None = None
_input_name: str = "input"


def _ensure_model() -> None:
    global _session, _labels, _input_name
    if _session is not None:
        return
    if not MODEL_PATH.exists():
        raise RuntimeError(f"signs.onnx not found at {MODEL_PATH}. Run convert_signs_onnx.py locally then commit models/signs.onnx")
    _session    = ort.InferenceSession(str(MODEL_PATH), providers=["CPUExecutionProvider"])
    _input_name = _session.get_inputs()[0].name
    with open(LABELS_PATH) as f:
        _labels = json.load(f)
    # Warm-up: eliminates first-predict latency spike
    dummy = np.zeros((1, SEQUENCE_FRAMES, NUM_FEATURES), dtype=np.float32)
    _session.run(None, {_input_name: dummy})


class PredictRequest(BaseModel):
    sequence: list[list[float]]   # N × 150 (frontend sends exactly CAPTURE_FRAMES)


@router.post("/signs/predict")
def predict_sign(body: PredictRequest):
    try:
        _ensure_model()
    except Exception as e:
        raise HTTPException(503, f"Signs model unavailable: {e}")

    seq = np.array(body.sequence, dtype=np.float32)
    if seq.ndim != 2 or seq.shape[1] != NUM_FEATURES:
        raise HTTPException(400, f"Each frame must have {NUM_FEATURES} features, got shape {seq.shape}")

    # Pad or trim to exactly SEQUENCE_FRAMES
    if seq.shape[0] < SEQUENCE_FRAMES:
        pad = np.zeros((SEQUENCE_FRAMES - seq.shape[0], NUM_FEATURES), dtype=np.float32)
        seq = np.vstack([seq, pad])
    seq = seq[:SEQUENCE_FRAMES]

    probs = _session.run(None, {_input_name: seq[np.newaxis]})[0][0]
    idx   = int(np.argmax(probs))

    return {"sign": _labels[idx], "confidence": float(probs[idx])}


@router.get("/signs/labels")
def get_labels():
    try:
        _ensure_model()
    except Exception as e:
        raise HTTPException(503, f"Signs model unavailable: {e}")
    return {"labels": _labels}
