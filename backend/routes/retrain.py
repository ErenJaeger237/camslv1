"""
retrain.py — background retraining pipeline.

Triggered automatically every AUTO_RETRAIN_EVERY new contributions,
or manually via POST /api/retrain/trigger.

Pipeline (all in-process, no subprocesses):
  1. Read backend/data/contributions.csv
  2. Merge with data/features.csv  → combined dataset
  3. Retrain Keras MLP (20 fast epochs, no RandomForest for speed)
  4. Export raw weights binary  → frontend/public/models/alphabet/group1-shard1of1.bin
  5. Bump model_version so the frontend knows to hot-reload

The weight binary format matches useInference.ts exactly:
  Dense(256) kernel+bias, BN(256)×4, Dense(128) kernel+bias, BN(128)×4,
  Dense(64) kernel+bias, BN(64)×4, Dense(24) kernel+bias
"""

import csv
import threading
import time
from pathlib import Path

import numpy as np
from fastapi import APIRouter

router = APIRouter()

ROOT         = Path(__file__).parent.parent.parent          # project root
CONTRIB_CSV  = ROOT / "backend" / "data" / "contributions.csv"
FEATURES_CSV = ROOT / "data" / "features.csv"
WEIGHTS_OUT  = ROOT / "frontend" / "public" / "models" / "alphabet" / "group1-shard1of1.bin"
VERSION_FILE = ROOT / "frontend" / "public" / "models" / "alphabet" / "version.json"

AUTO_RETRAIN_EVERY = 25   # trigger after every N new contributions
FAST_EPOCHS        = 20   # epochs for background retrain (full train.py uses 50)
HIDDEN_UNITS       = [256, 128, 64]
DROPOUT_RATE       = 0.3
BATCH_SIZE         = 64
LEARNING_RATE      = 1e-3

_lock  = threading.Lock()
_thread: threading.Thread | None = None
_contrib_count_at_last_check = 0


def _load_version() -> int:
    try:
        import json
        return json.loads(VERSION_FILE.read_text())["v"]
    except Exception:
        return 0


def _save_version(v: int) -> None:
    import json
    VERSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    VERSION_FILE.write_text(json.dumps({"v": v}))


_state: dict = {"state": "idle", "message": "", "version": _load_version()}


def _set(state: str, msg: str) -> None:
    with _lock:
        _state["state"] = state
        _state["message"] = msg


# ── Public helpers called by contributions route ───────────────────────────────

def maybe_auto_retrain(total_contributions: int) -> None:
    """Call after every new contribution. Fires retrain when threshold crossed."""
    global _contrib_count_at_last_check
    if total_contributions == 0:
        return
    if (total_contributions % AUTO_RETRAIN_EVERY == 0 and
            total_contributions != _contrib_count_at_last_check):
        _contrib_count_at_last_check = total_contributions
        _trigger()


def _trigger() -> bool:
    global _thread
    with _lock:
        if _state["state"] == "running":
            return False
        _state["state"] = "running"
        _state["message"] = "Starting…"
    _thread = threading.Thread(target=_run_safe, daemon=True)
    _thread.start()
    return True


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/retrain/trigger")
def trigger():
    started = _trigger()
    return {"ok": started, "message": "Started" if started else "Already running"}


@router.get("/retrain/status")
def status():
    with _lock:
        return dict(_state)


# ── Retraining pipeline ────────────────────────────────────────────────────────

def _run_safe():
    try:
        _run_pipeline()
    except Exception as e:
        _set("failed", str(e))


def _run_pipeline():
    import tensorflow as tf
    from tensorflow import keras
    from tensorflow.keras import layers as L

    # ── 1. Load contributions ─────────────────────────────────────────────────
    _set("running", "Reading contributions…")

    contrib_rows = []
    if CONTRIB_CSV.exists():
        with open(CONTRIB_CSV, newline="") as f:
            for row in csv.DictReader(f):
                feats = [float(x) for x in row["features"].split(",")]
                if len(feats) == 63:
                    contrib_rows.append((feats, row["label"].upper()))

    if not contrib_rows:
        _set("failed", "No contributions found — add samples first.")
        return

    # ── 2. Load existing base dataset ─────────────────────────────────────────
    _set("running", "Merging datasets…")

    base_rows: list[tuple[list[float], str]] = []
    if FEATURES_CSV.exists():
        with open(FEATURES_CSV, newline="") as f:
            reader = csv.DictReader(f)
            feature_cols = [c for c in (reader.fieldnames or []) if c != "label"]
            for row in reader:
                try:
                    feats = [float(row[c]) for c in feature_cols]
                    if len(feats) == 63:
                        base_rows.append((feats, row["label"].upper()))
                except Exception:
                    pass

    all_rows = base_rows + contrib_rows
    if len(all_rows) < 50:
        _set("failed", f"Only {len(all_rows)} samples — need at least 50 to retrain.")
        return

    # ── 3. Build arrays ───────────────────────────────────────────────────────
    labels = sorted(set(r[1] for r in all_rows))
    label_to_idx = {l: i for i, l in enumerate(labels)}
    num_classes = len(labels)

    X = np.array([r[0] for r in all_rows], dtype=np.float32)
    y = np.array([label_to_idx[r[1]] for r in all_rows], dtype=np.int32)

    # Shuffle
    rng = np.random.default_rng(42)
    idx = rng.permutation(len(X))
    X, y = X[idx], y[idx]

    # 80/20 split (fast retrain — no separate val set needed for speed)
    split = int(len(X) * 0.8)
    X_train, X_val = X[:split], X[split:]
    y_train, y_val = y[:split], y[split:]

    _set("running", f"Training on {len(X_train)} samples ({num_classes} classes)…")

    # ── 4. Build + train model ────────────────────────────────────────────────
    tf.config.threading.set_inter_op_parallelism_threads(2)
    tf.config.threading.set_intra_op_parallelism_threads(2)

    model = keras.Sequential(name="asl_mlp")
    model.add(keras.Input(shape=(63,)))
    for units in HIDDEN_UNITS:
        model.add(L.Dense(units, activation="relu"))
        model.add(L.BatchNormalization())
        model.add(L.Dropout(DROPOUT_RATE))
    model.add(L.Dense(num_classes, activation="softmax"))

    model.compile(
        optimizer=keras.optimizers.Adam(LEARNING_RATE),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )

    model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=FAST_EPOCHS,
        batch_size=BATCH_SIZE,
        callbacks=[
            keras.callbacks.EarlyStopping(
                monitor="val_accuracy", patience=5,
                restore_best_weights=True, verbose=0,
            ),
        ],
        verbose=0,
    )

    val_acc = model.evaluate(X_val, y_val, verbose=0)[1]

    # ── 5. Export weights binary ──────────────────────────────────────────────
    _set("running", f"Exporting model (val_acc={val_acc:.2%})…")
    WEIGHTS_OUT.parent.mkdir(parents=True, exist_ok=True)

    with open(WEIGHTS_OUT, "wb") as f:
        for layer in model.layers:
            for w in layer.weights:
                f.write(w.numpy().astype(np.float32).tobytes())

    version = int(time.time())
    _save_version(version)

    with _lock:
        _state["state"] = "done"
        _state["message"] = f"Retrained — val accuracy {val_acc:.1%} ({len(all_rows)} samples)"
        _state["version"] = version

    # Free memory
    del model, X, y
    import gc; gc.collect()
