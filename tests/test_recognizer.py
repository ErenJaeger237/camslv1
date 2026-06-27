"""
tests/test_recognizer.py

Unit tests for the Recognizer class — label list, confidence threshold
filtering, and input shape handling.

These tests do NOT load the Keras model (which requires a trained
models/alphabet.keras file).  Instead they test:
  1. The ALPHABET_LABELS constant is correct.
  2. The predict() method correctly filters low-confidence predictions.
  3. The predict() method returns (None, float) below the threshold.
  4. The predict() method returns (str, float) at or above the threshold.

A lightweight mock model is used so no GPU/TF model file is required
to run these tests.

Run:
    pytest tests/test_recognizer.py -v
"""

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from recognizer import ALPHABET_LABELS, CONFIDENCE_THRESHOLD, Recognizer


# ---------------------------------------------------------------------------
# Label constant tests — no model required
# ---------------------------------------------------------------------------

class TestAlphabetLabels:
    """ALPHABET_LABELS must match the expected 24-letter set (no J or Z)."""

    def test_label_count(self):
        assert len(ALPHABET_LABELS) == 24, (
            f"Expected 24 labels (A-Y excluding J/Z), got {len(ALPHABET_LABELS)}"
        )

    def test_j_excluded(self):
        assert "J" not in ALPHABET_LABELS, "J requires motion — must be excluded"

    def test_z_excluded(self):
        assert "Z" not in ALPHABET_LABELS, "Z requires motion — must be excluded"

    def test_labels_are_sorted(self):
        assert ALPHABET_LABELS == sorted(ALPHABET_LABELS), (
            "Labels must be sorted so they match sklearn's LabelEncoder order"
        )

    def test_all_labels_are_uppercase_single_chars(self):
        for lbl in ALPHABET_LABELS:
            assert len(lbl) == 1 and lbl.isupper(), (
                f"Label {lbl!r} is not a single uppercase character"
            )


# ---------------------------------------------------------------------------
# Recognizer.predict() tests — mock the Keras model
# ---------------------------------------------------------------------------

def _make_recognizer_with_mock_probs(probs: np.ndarray) -> Recognizer:
    """
    Return a Recognizer whose internal model always predicts `probs`
    regardless of the input.  The Keras model is fully mocked so no
    .keras file is needed.
    """
    mock_model = MagicMock()
    mock_model.predict.return_value = probs[np.newaxis]  # batch dimension

    rec = object.__new__(Recognizer)  # bypass __init__ (which calls load_model)
    rec._model = mock_model
    rec._labels = ALPHABET_LABELS
    rec._threshold = CONFIDENCE_THRESHOLD
    rec._model_path = Path("models/alphabet.keras")
    return rec


class TestRecognizerPredict:
    """predict() should filter by confidence threshold and return correct types."""

    def _uniform_probs(self) -> np.ndarray:
        """Equal probability across all classes — well below any threshold."""
        n = len(ALPHABET_LABELS)
        return np.full((n,), 1.0 / n, dtype=np.float32)

    def _high_confidence_probs(self, target_idx: int = 0) -> np.ndarray:
        """Confidence 0.99 on one class, rest spread over others."""
        n = len(ALPHABET_LABELS)
        probs = np.full((n,), 0.01 / (n - 1), dtype=np.float32)
        probs[target_idx] = 0.99
        return probs

    def test_below_threshold_returns_none_letter(self):
        """Uniform (low) confidence → predict() must return (None, float)."""
        probs = self._uniform_probs()
        rec = _make_recognizer_with_mock_probs(probs)
        letter, confidence = rec.predict(np.zeros(63, dtype=np.float32))
        assert letter is None, "Low-confidence prediction must return None for letter"
        assert isinstance(confidence, float)

    def test_high_confidence_returns_letter(self):
        """High confidence on index 0 → predict() must return the correct label."""
        probs = self._high_confidence_probs(target_idx=0)
        rec = _make_recognizer_with_mock_probs(probs)
        letter, confidence = rec.predict(np.zeros(63, dtype=np.float32))
        assert letter == ALPHABET_LABELS[0], (
            f"Expected {ALPHABET_LABELS[0]!r}, got {letter!r}"
        )
        assert confidence > CONFIDENCE_THRESHOLD

    def test_confidence_is_float_in_range(self):
        """confidence must always be a float in [0, 1]."""
        for probs in [self._uniform_probs(), self._high_confidence_probs()]:
            rec = _make_recognizer_with_mock_probs(probs)
            _, confidence = rec.predict(np.zeros(63, dtype=np.float32))
            assert isinstance(confidence, float)
            assert 0.0 <= confidence <= 1.0, f"confidence out of range: {confidence}"

    def test_exact_threshold_returns_letter(self):
        """Confidence exactly at threshold should pass (>= comparison)."""
        n = len(ALPHABET_LABELS)
        probs = np.zeros(n, dtype=np.float32)
        probs[0] = CONFIDENCE_THRESHOLD                    # exactly at threshold
        probs[1:] = (1.0 - CONFIDENCE_THRESHOLD) / (n - 1)
        rec = _make_recognizer_with_mock_probs(probs)
        letter, confidence = rec.predict(np.zeros(63, dtype=np.float32))
        assert letter is not None, (
            "Prediction at exactly the confidence threshold should NOT be filtered"
        )

    def test_predict_calls_model_with_correct_batch_shape(self):
        """predict() must add the batch dimension before calling model.predict."""
        probs = self._high_confidence_probs()
        rec = _make_recognizer_with_mock_probs(probs)
        features = np.zeros(63, dtype=np.float32)
        rec.predict(features)
        # model.predict should have been called with shape (1, 63)
        call_args = rec._model.predict.call_args
        input_array = call_args[0][0]
        assert input_array.shape == (1, 63), (
            f"Model received shape {input_array.shape}, expected (1, 63)"
        )
