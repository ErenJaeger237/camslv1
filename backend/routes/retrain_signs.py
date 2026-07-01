"""
retrain_signs.py — Background retraining pipeline for word-sign contributions.

Uses scikit-learn RandomForestClassifier (no tensorflow needed) so it runs
on Render's free tier without the 400 MB tensorflow-cpu install.

Feature extraction: each (T, 126) contribution sequence is reduced to a
378-d temporal vector using only the first 63 features (dominant hand) — this
matches both the contribution format (126 = two hands) and the prediction
format (150 = holistic, where [0:63] is the dominant hand).

Trigger:
  - Auto: every RETRAIN_EVERY=10 new word-sign contributions
  - Manual: POST /api/retrain-signs/trigger

After training, hot-reloads the contrib model in signs.py so new predictions
reflect the CamSL-contributed data immediately, without a redeploy.
"""

import json
import pickle
import threading
from pathlib import Path

import numpy as np
from fastapi import APIRouter
from sklearn.ensemble import RandomForestClassifier

router = APIRouter()

ROOT           = Path(__file__).resolve().parents[2]
WORD_SIGNS_DIR = ROOT / "backend" / "data" / "word_signs"
CONTRIB_PKL    = ROOT / "models" / "signs_contrib.pkl"
CONTRIB_LABELS = ROOT / "models" / "signs_contrib_labels.json"

RETRAIN_EVERY        = 10   # new word contributions before auto-trigger
MIN_SAMPLES_PER_SIGN = 3    # minimum samples per sign to include it in training
SEQUENCE_FRAMES      = 30
HAND_FEATURES        = 63   # first 63 of each frame (dominant hand)

_lock   = threading.Lock()
_thread: threading.Thread | None = None
_state: dict = {"state": "idle", "message": ""}
_contrib_watermark = 0      # total contributions at last retrain trigger


def extract_sequence_features(seq: np.ndarray) -> np.ndarray:
    """Convert a variable-length (T, ≥63) sequence to a fixed 378-d vector.

    Uses 6 temporal statistics over the dominant-hand landmarks:
      mean, std, velocity (mean |frame diff|), start frame, mid frame, end frame.
    Compatible with both contribution sequences (126 features) and prediction
    sequences (150 features) since both share [0:63] as the dominant hand.
    """
    hand = seq[:, :HAND_FEATURES].astype(np.float32)

    if hand.shape[0] < SEQUENCE_FRAMES:
        pad = np.zeros((SEQUENCE_FRAMES - hand.shape[0], HAND_FEATURES), dtype=np.float32)
        hand = np.vstack([hand, pad])
    hand = hand[:SEQUENCE_FRAMES]

    mean  = hand.mean(axis=0)
    std   = hand.std(axis=0)
    vel   = np.abs(np.diff(hand, axis=0)).mean(axis=0)
    start = hand[0]
    mid   = hand[SEQUENCE_FRAMES // 2]
    end   = hand[-1]
    return np.concatenate([mean, std, vel, start, mid, end])  # 378 features


def _count_all_word_contributions() -> int:
    if not WORD_SIGNS_DIR.exists():
        return 0
    return sum(
        len(list(d.glob("*.json")))
        for d in WORD_SIGNS_DIR.iterdir()
        if d.is_dir()
    )


def maybe_auto_retrain(total: int) -> None:
    """Called after every new word-sign contribution. Fires when threshold crossed."""
    global _contrib_watermark
    if total < RETRAIN_EVERY:
        return
    bucket = (total // RETRAIN_EVERY) * RETRAIN_EVERY
    if bucket > _contrib_watermark:
        _contrib_watermark = bucket
        _trigger()


def _trigger() -> bool:
    global _thread
    with _lock:
        if _state["state"] == "running":
            return False
        _state["state"] = "running"
        _state["message"] = "Starting..."
    _thread = threading.Thread(target=_run_safe, daemon=True)
    _thread.start()
    return True


def _set(state: str, msg: str) -> None:
    with _lock:
        _state["state"] = state
        _state["message"] = msg


def _run_safe() -> None:
    try:
        _run_pipeline()
    except Exception as e:
        _set("failed", str(e))


def _run_pipeline() -> None:
    _set("running", "Loading contributed sequences...")

    if not WORD_SIGNS_DIR.exists():
        _set("failed", "No word-sign contributions found. Record some signs first.")
        return

    X_all: list[np.ndarray] = []
    y_all: list[str] = []
    qualifying: list[str] = []

    for sign_dir in sorted(WORD_SIGNS_DIR.iterdir()):
        if not sign_dir.is_dir():
            continue
        sign = sign_dir.name
        samples: list[np.ndarray] = []

        for fp in sign_dir.glob("*.json"):
            try:
                with open(fp) as f:
                    raw = json.load(f)
                seq = np.array(raw, dtype=np.float32)
                # Accept any sequence with enough frames and at least 63 features
                if seq.ndim == 2 and seq.shape[1] >= HAND_FEATURES and seq.shape[0] >= 10:
                    samples.append(extract_sequence_features(seq))
            except Exception:
                pass

        if len(samples) >= MIN_SAMPLES_PER_SIGN:
            qualifying.append(sign)
            X_all.extend(samples)
            y_all.extend([sign] * len(samples))

    if len(qualifying) < 2:
        _set(
            "failed",
            f"Need at least 2 signs with {MIN_SAMPLES_PER_SIGN}+ samples each. "
            f"Currently {len(qualifying)} qualifying sign(s): {qualifying}. Keep recording!",
        )
        return

    X = np.array(X_all, dtype=np.float32)
    y = np.array(y_all)
    n_samples = len(X)

    _set("running", f"Training on {n_samples} samples across {len(qualifying)} signs...")

    clf = RandomForestClassifier(
        n_estimators=200,
        max_depth=None,
        min_samples_leaf=1,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    clf.fit(X, y)

    _set("running", "Saving CamSL word-sign model...")
    CONTRIB_PKL.parent.mkdir(parents=True, exist_ok=True)

    with open(CONTRIB_PKL, "wb") as f:
        pickle.dump(clf, f)
    with open(CONTRIB_LABELS, "w") as f:
        json.dump(sorted(qualifying), f, indent=2)

    # Hot-reload in the prediction module (local import avoids circular dependency)
    from . import signs as signs_mod
    signs_mod.reload_contrib_model()

    _set(
        "done",
        f"CamSL model ready — {n_samples} samples, {len(qualifying)} signs: "
        f"{', '.join(sorted(qualifying))}",
    )


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/retrain-signs/trigger")
def trigger():
    started = _trigger()
    return {"ok": started, "message": "Started" if started else "Already running"}


@router.get("/retrain-signs/status")
def status():
    with _lock:
        return dict(_state)
