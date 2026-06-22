"""
train_signs.py — Step 4.5b of the pipeline.

Loads the hand-landmark sequences recorded by record_signs.py and trains a
small LSTM classifier for word-sign recognition.

Architecture
------------
  Input   : (SEQUENCE_FRAMES, 63)  — 30 frames × 63 normalised landmark features
  LSTM(64, return_sequences=False)
  Dropout(0.3)
  Dense(32, relu)
  Dropout(0.15)
  Dense(num_signs, softmax)

Chosen over a plain MLP because signs involve motion — the same hand shape
held statically might mean different signs depending on movement direction.
LSTM captures that temporal pattern.  On CPU it runs in ~2–5 ms per sequence,
well within real-time budget.

Outputs
-------
  models/signs.keras                  — saved Keras model
  models/signs_labels.json            — ordered class names (loaded by app.py)
  outputs/signs_confusion.png         — normalised confusion matrix  (Figure 4.x)
  outputs/signs_training_curves.png   — accuracy / loss curves       (Figure 4.x)
  outputs/signs_results.txt           — all metrics for Chapter 4 tables

Run:
    python src/train_signs.py
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import matplotlib.pyplot as plt
import numpy as np
import seaborn as sns
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
)
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT  = Path(__file__).resolve().parent.parent
DATA_DIR      = PROJECT_ROOT / "data" / "signs"
MODEL_OUT     = PROJECT_ROOT / "models" / "signs.keras"
LABELS_OUT    = PROJECT_ROOT / "models" / "signs_labels.json"
OUTPUTS_DIR   = PROJECT_ROOT / "outputs"

# ---------------------------------------------------------------------------
# Hyperparameters
# ---------------------------------------------------------------------------
from landmarks import NUM_HOLISTIC_FEATURES

SEQUENCE_FRAMES       = 30                    # must match record_signs.py
NUM_FEATURES          = NUM_HOLISTIC_FEATURES # 150: hand(63) + face(60) + pose(27)
LSTM_UNITS            = 64
DENSE_UNITS           = 32
DROPOUT_RATE          = 0.30
LEARNING_RATE         = 1e-3
EPOCHS                = 80
BATCH_SIZE            = 16      # small dataset warrants a small batch
TEST_SIZE             = 0.20
VAL_SIZE              = 0.15
RANDOM_STATE          = 42
EARLY_STOP_PATIENCE   = 12
MIN_SAMPLES_PER_CLASS = 5       # signs with fewer samples are skipped with a warning


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_sequences() -> tuple[np.ndarray, np.ndarray, LabelEncoder]:
    """
    Walk data/signs/<sign>/sample_NNN.npy and build X, y arrays.

    Returns
    -------
    X  : (n_samples, SEQUENCE_FRAMES, NUM_FEATURES)  float32
    y  : (n_samples,)                                 int class indices
    le : fitted LabelEncoder  (le.classes_ = sign names in sorted order)
    """
    X_list, y_list, skipped = [], [], []

    for sign_dir in sorted(DATA_DIR.iterdir()):
        if not sign_dir.is_dir():
            continue
        sign  = sign_dir.name
        files = sorted(sign_dir.glob("sample_*.npy"))

        if len(files) < MIN_SAMPLES_PER_CLASS:
            skipped.append(f"  {sign}: {len(files)} samples (need {MIN_SAMPLES_PER_CLASS}+)")
            continue

        for f in files:
            seq = np.load(f).astype(np.float32)
            # Pad short sequences with zeros; truncate long ones
            if seq.shape[0] < SEQUENCE_FRAMES:
                pad = np.zeros((SEQUENCE_FRAMES - seq.shape[0], NUM_FEATURES),
                               dtype=np.float32)
                seq = np.vstack([seq, pad])
            seq = seq[:SEQUENCE_FRAMES]
            X_list.append(seq)
            y_list.append(sign)

    if skipped:
        print("WARNING — signs skipped (too few samples):")
        print("\n".join(skipped))

    if not X_list:
        raise ValueError(
            f"No training data found in {DATA_DIR}.\n"
            "Run  python src/record_signs.py  first and collect at least "
            f"{MIN_SAMPLES_PER_CLASS} samples per sign."
        )

    X  = np.stack(X_list)
    le = LabelEncoder()
    y  = le.fit_transform(y_list)

    print(f"\nLoaded {len(X)} sequences  |  {len(le.classes_)} signs")
    for i, name in enumerate(le.classes_):
        print(f"  {name:<12} {(y == i).sum()} samples")
    print()
    return X, y, le


# ---------------------------------------------------------------------------
# Model definition
# ---------------------------------------------------------------------------

def build_lstm(num_classes: int) -> keras.Model:
    """
    LSTM with temporal self-attention for sign classification.

    Architecture:
      Input(30, 63)
      → LSTM(64, return_sequences=True)   — hidden state at every frame
      → MultiHeadAttention(2 heads)       — learns which frames matter most
      → GlobalAveragePooling1D            — aggregate attended sequence
      → Dropout(0.3)
      → Dense(32, relu)
      → Dense(num_classes, softmax)

    Why attention: a sign passes through preparation → stroke → hold phases.
    The stroke/hold frames carry the meaning; preparation frames are noise.
    Attention lets the model weight those apex frames more heavily without
    being told explicitly where they are — it learns this from the data.
    A plain LSTM compresses all 30 frames into one vector with equal weighting.
    """
    inp = keras.Input(shape=(SEQUENCE_FRAMES, NUM_FEATURES), name="landmarks")

    # LSTM over full sequence — keep all 30 hidden states
    x = layers.LSTM(LSTM_UNITS, return_sequences=True, name="lstm")(inp)

    # Self-attention: each frame queries all other frames to decide its weight
    x = layers.MultiHeadAttention(
        num_heads=2, key_dim=LSTM_UNITS // 2, name="temporal_attention"
    )(x, x)

    # Pool the attended sequence into a single vector
    x = layers.GlobalAveragePooling1D(name="pool")(x)
    x = layers.Dropout(DROPOUT_RATE, name="drop1")(x)
    x = layers.Dense(DENSE_UNITS, activation="relu", name="dense1")(x)
    x = layers.Dropout(DROPOUT_RATE / 2, name="drop2")(x)
    out = layers.Dense(num_classes, activation="softmax", name="output")(x)

    return keras.Model(inp, out, name="sign_lstm_attention")


# ---------------------------------------------------------------------------
# Plots
# ---------------------------------------------------------------------------

def plot_confusion(y_true, y_pred, class_names, out_path: Path) -> None:
    cm      = confusion_matrix(y_true, y_pred)
    cm_norm = cm.astype(float) / cm.sum(axis=1, keepdims=True)
    fig, ax = plt.subplots(figsize=(10, 8))
    sns.heatmap(cm_norm, annot=True, fmt=".2f", cmap="Blues",
                xticklabels=class_names, yticklabels=class_names, ax=ax)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("True")
    ax.set_title("Word-Sign LSTM — Normalised Confusion Matrix")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"Confusion matrix  -> {out_path}")


def plot_curves(history, out_path: Path) -> None:
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4))
    ax1.plot(history.history["accuracy"],     label="Train")
    ax1.plot(history.history["val_accuracy"], label="Validation")
    ax1.set_title("Accuracy")
    ax1.set_xlabel("Epoch")
    ax1.legend()
    ax2.plot(history.history["loss"],     label="Train")
    ax2.plot(history.history["val_loss"], label="Validation")
    ax2.set_title("Loss")
    ax2.set_xlabel("Epoch")
    ax2.legend()
    fig.suptitle("Training Curves — Word-Sign LSTM")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"Training curves   -> {out_path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)

    # ── Load data ─────────────────────────────────────────────────────────
    X, y, le = load_sequences()
    class_names = list(le.classes_)
    num_classes = len(class_names)

    # ── 70 / 15 / 15 split (mirrors train.py for consistency) ─────────────
    val_frac = VAL_SIZE / (1.0 - TEST_SIZE)      # fraction of the non-test set
    X_tv, X_test, y_tv, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y
    )
    X_train, X_val, y_train, y_val = train_test_split(
        X_tv, y_tv, test_size=val_frac, random_state=RANDOM_STATE, stratify=y_tv
    )
    print(f"Split  ->  train: {len(X_train)}  |  val: {len(X_val)}  |  test: {len(X_test)}\n")

    # ── Build & compile ───────────────────────────────────────────────────
    model = build_lstm(num_classes)
    model.compile(
        optimizer=keras.optimizers.Adam(LEARNING_RATE),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )
    model.summary()

    callbacks = [
        keras.callbacks.EarlyStopping(
            monitor="val_accuracy",
            patience=EARLY_STOP_PATIENCE,
            restore_best_weights=True,
            verbose=1,
        ),
        keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.5, patience=5, verbose=1,
        ),
    ]

    # ── Train ─────────────────────────────────────────────────────────────
    t0 = time.perf_counter()
    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=EPOCHS,
        batch_size=BATCH_SIZE,
        callbacks=callbacks,
        verbose=1,
    )
    train_sec  = time.perf_counter() - t0
    epochs_run = len(history.history["accuracy"])

    # ── Evaluate on held-out test set ─────────────────────────────────────
    test_acc = model.evaluate(X_test, y_test, verbose=0)[1]
    y_pred   = np.argmax(model.predict(X_test, verbose=0), axis=1)
    report   = classification_report(y_test, y_pred, target_names=class_names)

    # ── Plots ─────────────────────────────────────────────────────────────
    plot_confusion(y_test, y_pred, class_names,
                   OUTPUTS_DIR / "signs_confusion.png")
    plot_curves(history, OUTPUTS_DIR / "signs_training_curves.png")

    # ── Save model + labels ───────────────────────────────────────────────
    model.save(MODEL_OUT)
    with open(LABELS_OUT, "w") as f:
        json.dump(class_names, f, indent=2)
    size_kb = MODEL_OUT.stat().st_size / 1024

    # ── Inference speed ───────────────────────────────────────────────────
    _ = model.predict(X_test[:1], verbose=0)          # warm-up
    t0 = time.perf_counter()
    model.predict(X_test[:50], verbose=0)
    ms_per = (time.perf_counter() - t0) / 50 * 1000

    # ── Results file ──────────────────────────────────────────────────────
    results = "\n".join([
        "=" * 56,
        "  Word-Sign LSTM — Results",
        "=" * 56,
        "",
        f"Signs trained : {class_names}",
        f"Total samples : {len(X)}",
        f"Split         : train={len(X_train)} | val={len(X_val)} | test={len(X_test)}",
        "",
        "Architecture",
        f"  LSTM({LSTM_UNITS}) -> Dropout({DROPOUT_RATE}) -> Dense({DENSE_UNITS}) -> Dense({num_classes})",
        "",
        "Results",
        f"  Test accuracy   : {test_acc:.4f}  ({test_acc*100:.2f}%)",
        f"  Training time   : {train_sec:.1f} s  over {epochs_run} epochs",
        f"  Inference speed : {ms_per:.2f} ms / sequence",
        f"  Model size      : {size_kb:.1f} KB",
        "",
        "Per-class report",
        report,
    ])

    out_txt = OUTPUTS_DIR / "signs_results.txt"
    out_txt.write_text(results, encoding="utf-8")
    print(results)
    print(f"\nModel saved   -> {MODEL_OUT}  ({size_kb:.1f} KB)")
    print(f"Labels saved  -> {LABELS_OUT}")


if __name__ == "__main__":
    main()
