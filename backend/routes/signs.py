"""
signs.py — Word-sign recognition endpoint.

POST /api/signs/predict   body: { sequence: [[150 floats] × N] }
                          returns: { sign, confidence, model }

GET  /api/signs/labels    returns: { labels: [str] }

Prediction priority:
  1. Contributed CamSL model (models/signs_contrib.pkl) — trained on user
     contributions, reflects real CamSL signing. Uses dominant-hand features
     (first 63 of each frame) via extract_sequence_features from retrain_signs.
  2. Base ONNX model (models/signs.onnx) — trained on WLASL (ASL) dataset,
     used when no contrib model exists yet.

The contrib model is hot-reloaded by retrain_signs.reload_contrib_model()
after every successful retraining run — no server restart needed.
"""

import json
import pickle
from pathlib import Path

import numpy as np
import onnxruntime as ort
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

_ROOT        = Path(__file__).resolve().parents[2]
MODEL_PATH   = _ROOT / "models" / "signs.onnx"
LABELS_PATH  = _ROOT / "models" / "signs_labels.json"
CONTRIB_PKL  = _ROOT / "models" / "signs_contrib.pkl"
CONTRIB_LBLS = _ROOT / "models" / "signs_contrib_labels.json"

SEQUENCE_FRAMES = 30
NUM_FEATURES    = 150   # holistic: hand(63) + face(60) + pose(27)

# ── Base ONNX model (WLASL) ────────────────────────────────────────────────────
_session: ort.InferenceSession | None = None
_labels: list | None = None
_input_name: str = "input"

# ── Contributed CamSL model (sklearn RF) ──────────────────────────────────────
_contrib_clf   = None
_contrib_labels: list | None = None


def _ensure_model() -> None:
    global _session, _labels, _input_name
    if _session is not None:
        return
    if not MODEL_PATH.exists():
        raise RuntimeError(
            f"signs.onnx not found at {MODEL_PATH}. "
            "Run convert_signs_onnx.py locally then commit models/signs.onnx"
        )
    _session    = ort.InferenceSession(str(MODEL_PATH), providers=["CPUExecutionProvider"])
    _input_name = _session.get_inputs()[0].name
    with open(LABELS_PATH) as f:
        _labels = json.load(f)
    # Warm-up run eliminates first-predict latency spike
    dummy = np.zeros((1, SEQUENCE_FRAMES, NUM_FEATURES), dtype=np.float32)
    _session.run(None, {_input_name: dummy})


def reload_contrib_model() -> None:
    """Hot-reload the contributed CamSL RF model. Called by retrain_signs after training."""
    global _contrib_clf, _contrib_labels
    if not CONTRIB_PKL.exists():
        _contrib_clf    = None
        _contrib_labels = None
        return
    with open(CONTRIB_PKL, "rb") as f:
        _contrib_clf = pickle.load(f)
    with open(CONTRIB_LBLS) as f:
        _contrib_labels = json.load(f)


def _ensure_contrib_model() -> None:
    """Lazy-load the contrib model on first request (if it exists)."""
    if _contrib_clf is not None:
        return
    reload_contrib_model()


class PredictRequest(BaseModel):
    sequence: list[list[float]]   # N × 150 from frontend holistic capture


@router.post("/signs/predict")
def predict_sign(body: PredictRequest):
    _ensure_contrib_model()

    seq = np.array(body.sequence, dtype=np.float32)
    if seq.ndim != 2 or seq.shape[1] != NUM_FEATURES:
        raise HTTPException(
            400, f"Each frame must have {NUM_FEATURES} features, got shape {seq.shape}"
        )

    # Pad or trim to SEQUENCE_FRAMES
    if seq.shape[0] < SEQUENCE_FRAMES:
        pad = np.zeros((SEQUENCE_FRAMES - seq.shape[0], NUM_FEATURES), dtype=np.float32)
        seq = np.vstack([seq, pad])
    seq = seq[:SEQUENCE_FRAMES]

    # ── Priority 1: Contributed CamSL model ────────────────────────────────────
    if _contrib_clf is not None and _contrib_labels:
        from .retrain_signs import extract_sequence_features
        feat = extract_sequence_features(seq).reshape(1, -1)
        probs   = _contrib_clf.predict_proba(feat)[0]
        classes = list(_contrib_clf.classes_)
        idx     = int(np.argmax(probs))
        return {
            "sign":       classes[idx],
            "confidence": float(probs[idx]),
            "model":      "contributed",
        }

    # ── Priority 2: Base ONNX model (WLASL / ASL) ──────────────────────────────
    try:
        _ensure_model()
    except Exception as e:
        raise HTTPException(503, f"Signs model unavailable: {e}")

    probs = _session.run(None, {_input_name: seq[np.newaxis]})[0][0]
    idx   = int(np.argmax(probs))
    return {
        "sign":       _labels[idx],
        "confidence": float(probs[idx]),
        "model":      "base",
    }


@router.get("/signs/labels")
def get_labels():
    _ensure_contrib_model()
    # Prefer contributed labels (CamSL-specific); fall back to ONNX labels
    if _contrib_labels:
        return {"labels": _contrib_labels, "model": "contributed"}
    try:
        _ensure_model()
    except Exception as e:
        raise HTTPException(503, f"Signs model unavailable: {e}")
    return {"labels": _labels, "model": "base"}
