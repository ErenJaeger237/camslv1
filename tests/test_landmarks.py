"""
tests/test_landmarks.py

Unit tests for the landmark normalisation math in LandmarkExtractor.
Uses synthetic landmark data — no webcam or MediaPipe model required.

Run:
    pytest tests/test_landmarks.py -v
"""

import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))


# ---------------------------------------------------------------------------
# Synthetic landmark helpers (avoids importing MediaPipe at test time)
# ---------------------------------------------------------------------------

class _FakeLM:
    def __init__(self, x, y, z=0.0):
        self.x, self.y, self.z = x, y, z


def make_landmarks(wrist=(0.5, 0.5), mcp9_offset=(0.1, 0.0)) -> list:
    """
    Build 21 fake landmark objects.
    All landmarks sit at `wrist` (translation anchor), except landmark 9 which
    is displaced by `mcp9_offset`.  Placing all non-special landmarks at the
    wrist position ensures the relative structure is the same regardless of
    where the wrist is in the image — a requirement for translation-invariance
    tests.
    """
    lms = [_FakeLM(wrist[0], wrist[1]) for _ in range(21)]
    lms[9] = _FakeLM(wrist[0] + mcp9_offset[0], wrist[1] + mcp9_offset[1])
    return lms


def _normalise(landmarks) -> np.ndarray:
    """
    Inline copy of LandmarkExtractor._normalise so tests don't need MediaPipe.
    Must stay in sync with the real implementation in landmarks.py.
    """
    coords = np.array([[lm.x, lm.y, lm.z] for lm in landmarks])
    coords -= coords[0]           # translate so wrist is origin
    scale   = np.linalg.norm(coords[9])
    if scale > 0:
        coords /= scale
    return coords.flatten().astype(np.float32)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestNormalisation:

    def test_wrist_is_origin_after_normalisation(self):
        lms    = make_landmarks(wrist=(0.3, 0.7))
        result = _normalise(lms)
        # Landmark 0 (wrist) should be at (0, 0, 0)
        assert np.allclose(result[0:3], [0.0, 0.0, 0.0], atol=1e-6)

    def test_scale_normalised_to_unit_length(self):
        lms    = make_landmarks(wrist=(0.5, 0.5), mcp9_offset=(0.2, 0.0))
        result = _normalise(lms)
        # Landmark 9 distance from origin should be 1.0 after normalisation
        lm9 = result[9*3 : 9*3+3]
        assert pytest.approx(np.linalg.norm(lm9), abs=1e-5) == 1.0

    def test_translation_invariance(self):
        """Shifting all landmarks by a constant should not change the result."""
        lms_a = make_landmarks(wrist=(0.1, 0.1))
        lms_b = make_landmarks(wrist=(0.9, 0.9))
        # Apply same offset structure to both — only wrist position differs
        out_a = _normalise(lms_a)
        out_b = _normalise(lms_b)
        assert np.allclose(out_a, out_b, atol=1e-5)

    def test_output_shape_is_63(self):
        lms    = make_landmarks()
        result = _normalise(lms)
        assert result.shape == (63,)

    def test_dtype_is_float32(self):
        lms    = make_landmarks()
        result = _normalise(lms)
        assert result.dtype == np.float32

    def test_zero_scale_does_not_crash(self):
        """If all landmarks are at the same point, scale = 0. Must not divide by zero."""
        lms    = [_FakeLM(0.5, 0.5) for _ in range(21)]
        result = _normalise(lms)
        assert result.shape == (63,)
        assert not np.any(np.isnan(result))


class TestHolisticFeatureCount:
    """Verify the holistic feature constants match what the code computes."""

    def test_holistic_feature_count(self):
        from landmarks import (
            FACE_KEY_LMS, POSE_KEY_LMS,
            NUM_FEATURES, NUM_HOLISTIC_FEATURES,
        )
        expected = NUM_FEATURES + len(FACE_KEY_LMS) * 3 + len(POSE_KEY_LMS) * 3
        assert NUM_HOLISTIC_FEATURES == expected

    def test_face_key_lms_are_valid_indices(self):
        from landmarks import FACE_KEY_LMS
        # MediaPipe face mesh has 478 landmarks; all indices must be in range
        assert all(0 <= i < 478 for i in FACE_KEY_LMS)

    def test_pose_key_lms_are_valid_indices(self):
        from landmarks import POSE_KEY_LMS
        # MediaPipe pose has 33 landmarks
        assert all(0 <= i < 33 for i in POSE_KEY_LMS)
