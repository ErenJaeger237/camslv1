"""
train.py — Step 2 of the pipeline.

Loads data/features.csv, trains a Keras MLP classifier on the 63 normalised
landmark features, evaluates it, and saves the model.

Also trains a scikit-learn RandomForest as a baseline for comparison.

Outputs (all in outputs/):
    confusion_matrix.png     — heatmap of per-class predictions (Figure 4.x)
    accuracy_curves.png      — training/validation accuracy and loss (Figure 4.x)
    results.txt              — all metrics + efficiency stats for Chapter 4 tables

Model saved to:
    models/alphabet.keras

Data split: 70 % train / 15 % validation / 15 % test
    Validation is used only during training (EarlyStopping).
    Test set is touched exactly once, at the end, to report final numbers.

Run:
    python src/train.py
"""

from pathlib import Path
import time

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from sklearn.ensemble import RandomForestClassifier
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
PROJECT_ROOT = Path(__file__).resolve().parent.parent
FEATURES_CSV = PROJECT_ROOT / "data" / "features.csv"
MODEL_OUT    = PROJECT_ROOT / "models" / "alphabet.keras"
OUTPUTS_DIR  = PROJECT_ROOT / "outputs"

# ---------------------------------------------------------------------------
# Hyperparameters — change here, not buried in code
# ---------------------------------------------------------------------------
TEST_SIZE           = 0.15      # 15 % held out for final evaluation  → 70/15/15
VAL_SIZE            = 0.15      # 15 % of full set used for validation during training
RANDOM_STATE        = 42        # reproducibility seed
EPOCHS              = 50
BATCH_SIZE          = 64
LEARNING_RATE       = 1e-3
DROPOUT_RATE        = 0.3       # regularisation to reduce overfitting on dataset images
HIDDEN_UNITS        = [256, 128, 64]    # MLP layer widths (input → … → num_classes)
EARLY_STOP_PATIENCE = 8         # stop if val_accuracy stalls for this many epochs

# Data augmentation — applied only to the training split, never to val/test.
# Small Gaussian noise on normalised landmarks simulates hand tremor and
# minor pose variation, helping the model generalise to live webcam input.
AUGMENT_COPIES  = 3             # noisy copies added per original training sample
AUGMENT_NOISE   = 0.015         # noise std-dev in normalised landmark units

INFERENCE_REPS  = 200           # samples used for inference-speed measurement


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_data(csv_path: Path) -> tuple[np.ndarray, np.ndarray, LabelEncoder]:
    """
    Read features.csv and return (X, y_encoded, label_encoder).
    X shape: (n_samples, 63)   y shape: (n_samples,) — integer class indices
    """
    df = pd.read_csv(csv_path)
    print(f"Loaded {len(df):,} samples, {df['label'].nunique()} classes.")
    print(f"Class distribution:\n{df['label'].value_counts().sort_index()}\n")

    X = df.drop(columns=["label"]).values.astype(np.float32)
    le = LabelEncoder()
    y = le.fit_transform(df["label"].values)
    return X, y, le


# ---------------------------------------------------------------------------
# Model definition
# ---------------------------------------------------------------------------

def build_mlp(num_features: int, num_classes: int) -> keras.Model:
    """
    Small feedforward network for real-time CPU inference.
    Input: 63 normalised landmark coordinates.
    Output: softmax probability over num_classes letters.
    """
    model = keras.Sequential(name="asl_mlp")
    model.add(keras.Input(shape=(num_features,)))
    for units in HIDDEN_UNITS:
        model.add(layers.Dense(units, activation="relu"))
        model.add(layers.BatchNormalization())
        model.add(layers.Dropout(DROPOUT_RATE))
    model.add(layers.Dense(num_classes, activation="softmax"))
    return model


# ---------------------------------------------------------------------------
# Training helpers
# ---------------------------------------------------------------------------

def augment(
    X: np.ndarray, y: np.ndarray, copies: int, noise_std: float
) -> tuple[np.ndarray, np.ndarray]:
    """
    Create `copies` noisy versions of every training sample and concatenate them.
    The augmented set is shuffled so copies don't sit in consecutive blocks.
    """
    rng = np.random.default_rng(seed=RANDOM_STATE)
    X_parts = [X]
    y_parts = [y]
    for _ in range(copies):
        noise = rng.normal(0, noise_std, size=X.shape).astype(np.float32)
        X_parts.append(X + noise)
        y_parts.append(y)
    X_out = np.concatenate(X_parts, axis=0)
    y_out = np.concatenate(y_parts, axis=0)
    idx = rng.permutation(len(X_out))
    return X_out[idx], y_out[idx]


def train_keras(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
    num_classes: int,
) -> tuple[keras.Model, tf.keras.callbacks.History, float]:
    """
    Compile and fit the MLP.  Validation set is kept separate from the test set
    so EarlyStopping does not see test-set labels during training.
    Returns (model, history, training_seconds).
    """
    model = build_mlp(X_train.shape[1], num_classes)
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
            monitor="val_loss",
            factor=0.5,
            patience=4,
            verbose=1,
        ),
    ]

    t0 = time.perf_counter()
    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=EPOCHS,
        batch_size=BATCH_SIZE,
        callbacks=callbacks,
        verbose=1,
    )
    training_seconds = time.perf_counter() - t0

    return model, history, training_seconds


def train_baseline(
    X_train_aug: np.ndarray,
    y_train_aug: np.ndarray,
    X_test: np.ndarray,
    y_test: np.ndarray,
    class_names: list[str],
) -> tuple[float, str]:
    """
    Train a RandomForest on the SAME augmented training split as the MLP and
    evaluate on the same test set.  Both models must receive identical input
    data for the comparison to be scientifically valid.

    Note: Gaussian-noise augmentation benefits continuous models (MLPs) more
    than tree-based models because trees make binary splits that are invariant
    to small perturbations.  Any accuracy gap therefore reflects a genuine
    architectural advantage, not a data-preparation artefact.
    """
    print("\nTraining RandomForest baseline (same augmented data as MLP)...")
    rf = RandomForestClassifier(n_estimators=200, random_state=RANDOM_STATE, n_jobs=-1)
    rf.fit(X_train_aug, y_train_aug)
    y_pred_rf = rf.predict(X_test)
    acc = accuracy_score(y_test, y_pred_rf)
    report = classification_report(y_test, y_pred_rf, target_names=class_names)
    print(f"RandomForest baseline accuracy: {acc:.4f}")
    return acc, report


def measure_inference_speed(
    model: keras.Model, X_sample: np.ndarray, reps: int = INFERENCE_REPS
) -> tuple[float, float]:
    """
    Time a batch prediction to estimate per-sample latency and implied FPS.
    One warm-up pass fires first so TF graph compilation is not counted.
    Returns (ms_per_sample, fps).
    """
    _ = model.predict(X_sample[:1], verbose=0)           # warm-up
    X_bench = X_sample[:reps]
    t0 = time.perf_counter()
    _ = model.predict(X_bench, verbose=0)
    elapsed = time.perf_counter() - t0
    ms_per_sample = (elapsed / reps) * 1000.0
    fps = 1000.0 / ms_per_sample
    return ms_per_sample, fps


# ---------------------------------------------------------------------------
# Plots
# ---------------------------------------------------------------------------

def plot_confusion_matrix(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    class_names: list[str],
    out_path: Path,
) -> None:
    cm = confusion_matrix(y_true, y_pred)
    cm_norm = cm.astype(float) / cm.sum(axis=1, keepdims=True)  # row-normalise → recall

    fig, ax = plt.subplots(figsize=(14, 12))
    sns.heatmap(
        cm_norm,
        annot=True, fmt=".2f", cmap="Blues",
        xticklabels=class_names, yticklabels=class_names, ax=ax,
    )
    ax.set_xlabel("Predicted label")
    ax.set_ylabel("True label")
    ax.set_title("Normalised Confusion Matrix — ASL MLP Classifier")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"Confusion matrix saved  -> {out_path}")


def plot_training_curves(history: tf.keras.callbacks.History, out_path: Path) -> None:
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

    fig.suptitle("Training Curves — ASL MLP Classifier")
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    print(f"Training curves saved   -> {out_path}")


# ---------------------------------------------------------------------------
# Results file
# ---------------------------------------------------------------------------

def save_results(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    class_names: list[str],
    keras_acc: float,
    rf_acc: float,
    rf_report: str,
    training_seconds: float,
    ms_per_sample: float,
    fps: float,
    model_size_kb: float,
    param_count: int,
    epochs_run: int,
    out_path: Path,
) -> None:
    """
    Write every number Chapter 4 needs into a single results.txt so it can be
    pasted directly into the dissertation.
    """
    keras_report = classification_report(y_true, y_pred, target_names=class_names)

    lines = [
        "=" * 60,
        "  ASL Alphabet Classifier - Full Results",
        "=" * 60,
        "",
        "--- Data split ---",
        f"  Train / Val / Test  :  70 % / 15 % / 15 %",
        f"  Test samples        :  {len(y_true):,}",
        "",
        "--- Model architecture (Keras MLP) ---",
        f"  Hidden layers       :  {HIDDEN_UNITS}",
        f"  Dropout rate        :  {DROPOUT_RATE}",
        f"  Total parameters    :  {param_count:,}",
        "",
        "--- Training configuration ---",
        f"  Epochs (max)        :  {EPOCHS}",
        f"  Epochs run          :  {epochs_run}",
        f"  Batch size          :  {BATCH_SIZE}",
        f"  Learning rate       :  {LEARNING_RATE}",
        f"  Augmentation copies :  {AUGMENT_COPIES}  (noise std = {AUGMENT_NOISE}, applied to BOTH models)",
        f"  Training time       :  {training_seconds:.1f} s",
        "",
        "--- Accuracy comparison (Table 4.2) ---",
        f"  Keras MLP           :  {keras_acc:.4f}  ({keras_acc*100:.2f} %)",
        f"  RandomForest base   :  {rf_acc:.4f}  ({rf_acc*100:.2f} %)",
        f"  Improvement         :  {(keras_acc - rf_acc)*100:+.2f} pp",
        "",
        "--- Efficiency metrics (Table 4.5) ---",
        f"  Inference latency   :  {ms_per_sample:.3f} ms / sample",
        f"  Implied FPS         :  {fps:.0f} frames / second",
        f"  Model file size     :  {model_size_kb:.1f} KB  ({model_size_kb/1024:.2f} MB)",
        "",
        "--- Per-class metrics - Keras MLP ---",
        keras_report,
        "",
        "--- Per-class metrics - RandomForest baseline ---",
        rf_report,
    ]

    text = "\n".join(lines)
    out_path.write_text(text, encoding="utf-8")
    print(f"\nResults saved          -> {out_path}")
    print(text)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    if not FEATURES_CSV.exists():
        raise FileNotFoundError(
            f"features.csv not found at {FEATURES_CSV}.\n"
            "Run  python src/extract_landmarks.py  first."
        )

    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)

    # --- Load ---
    X, y, le = load_data(FEATURES_CSV)
    class_names = list(le.classes_)
    num_classes = len(class_names)

    # --- 70 / 15 / 15 split ---
    # First carve off 15 % as the held-out test set (never seen during training).
    # Then split the remaining 85 % into 70 % train and 15 % validation.
    val_fraction = VAL_SIZE / (1.0 - TEST_SIZE)   # ≈ 0.176 of the 85 % remainder

    X_tv, X_test, y_tv, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y
    )
    X_train, X_val, y_train, y_val = train_test_split(
        X_tv, y_tv, test_size=val_fraction, random_state=RANDOM_STATE, stratify=y_tv
    )
    print(
        f"Split  ->  train: {len(X_train):,}  |  val: {len(X_val):,}  |  test: {len(X_test):,}\n"
    )

    # --- Augment training split only ---
    print(f"Augmenting training set ({AUGMENT_COPIES}x copies, noise std={AUGMENT_NOISE})...")
    X_train_aug, y_train_aug = augment(X_train, y_train, AUGMENT_COPIES, AUGMENT_NOISE)
    print(f"Augmented train size: {len(X_train_aug):,}\n")

    # --- Baseline (same augmented data as MLP for a fair comparison) ---
    rf_acc, rf_report = train_baseline(X_train_aug, y_train_aug, X_test, y_test, class_names)

    # --- Keras MLP ---
    print("\nTraining Keras MLP...")
    model, history, training_seconds = train_keras(
        X_train_aug, y_train_aug, X_val, y_val, num_classes
    )
    epochs_run = len(history.history["accuracy"])

    # --- Evaluate on test set (touched exactly once) ---
    keras_acc = model.evaluate(X_test, y_test, verbose=0)[1]
    y_pred    = np.argmax(model.predict(X_test, verbose=0), axis=1)

    # --- Plots ---
    plot_confusion_matrix(y_test, y_pred, class_names, OUTPUTS_DIR / "confusion_matrix.png")
    plot_training_curves(history, OUTPUTS_DIR / "accuracy_curves.png")

    # --- Save model, then measure its size ---
    model.save(MODEL_OUT)
    model_size_kb = MODEL_OUT.stat().st_size / 1024.0

    # --- Efficiency ---
    ms_per_sample, fps = measure_inference_speed(model, X_test)
    param_count = model.count_params()

    # --- All results to file ---
    save_results(
        y_test, y_pred, class_names,
        keras_acc, rf_acc, rf_report,
        training_seconds, ms_per_sample, fps,
        model_size_kb, param_count, epochs_run,
        OUTPUTS_DIR / "results.txt",
    )

    print(f"\nModel saved            -> {MODEL_OUT}  ({model_size_kb:.1f} KB)")
    print(f"Final test accuracy    :  {keras_acc:.4f}  (baseline: {rf_acc:.4f})")
    print(f"Training time          :  {training_seconds:.1f} s  over {epochs_run} epochs")
    print(f"Inference speed        :  {ms_per_sample:.3f} ms/sample  ~  {fps:.0f} FPS")


if __name__ == "__main__":
    main()
