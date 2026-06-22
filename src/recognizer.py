"""
recognizer.py — Loads the trained alphabet model and predicts letters.

Takes a (63,) normalised landmark feature vector (from landmarks.py)
and returns the predicted letter with a confidence score.
"""

from pathlib import Path

import numpy as np
import tensorflow as tf

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH   = PROJECT_ROOT / "models" / "alphabet.keras"

# Sorted alphabetically, J and Z excluded — must match the LabelEncoder
# order used in train.py (sklearn sorts classes lexicographically).
ALPHABET_LABELS = sorted("ABCDEFGHIKLMNOPQRSTUVWXY")

# Predictions below this confidence are discarded (treated as "no letter")
CONFIDENCE_THRESHOLD = 0.80


class Recognizer:
    """Wraps the Keras MLP for single-frame letter prediction."""

    def __init__(
        self,
        model_path: Path = MODEL_PATH,
        labels: list = ALPHABET_LABELS,
        confidence_threshold: float = CONFIDENCE_THRESHOLD,
    ):
        self._model_path = model_path
        self.load_model(model_path)
        self._labels    = labels
        self._threshold = confidence_threshold

    def load_model(self, model_path: Path = None):
        """Reload the model weights from disk."""
        path = model_path or self._model_path
        self._model = tf.keras.models.load_model(str(path))

    def predict(self, features: np.ndarray) -> tuple:
        """
        Predict a letter from a (63,) feature vector.

        Returns
        -------
        letter : str or None
            The predicted letter, or None if confidence is below the threshold.
        confidence : float
            Softmax probability of the top prediction (0–1).
        """
        # Model expects shape (batch, 63) — add the batch dimension
        probs      = self._model.predict(features[np.newaxis], verbose=0)[0]
        idx        = int(np.argmax(probs))
        confidence = float(probs[idx])

        if confidence < self._threshold:
            return None, confidence

        return self._labels[idx], confidence
