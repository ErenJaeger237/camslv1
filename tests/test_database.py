"""
tests/test_database.py

Unit tests for LeitnerDB — the spaced repetition persistence layer.
These tests use a temporary in-memory-style SQLite file so they do not
touch the real data/learning.db.  No MediaPipe, no Keras required.

Run:
    pytest tests/test_database.py -v
"""

import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from database import BOX_INTERVALS, LeitnerDB

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

LABELS = list("ABCDEFGHIKLMNOPQRSTUVWXY")   # 24 letters, no J/Z


def make_db() -> tuple[LeitnerDB, Path]:
    """Create a fresh LeitnerDB in a temp directory for each test."""
    tmp = tempfile.mkdtemp()
    db_path = Path(tmp) / "test_learning.db"
    db = LeitnerDB(db_path, LABELS)
    db.init()
    return db, db_path


# ---------------------------------------------------------------------------
# Schema & initialisation tests
# ---------------------------------------------------------------------------

class TestLeitnerDBInit:
    """The database should initialise cleanly and seed all labels."""

    def test_init_creates_rows_for_all_labels(self):
        db, _ = make_db()
        mastery = db.overall_mastery()
        # All letters start at Box 1 → mastery = 0 %
        assert mastery == 0, "Fresh DB should report 0 % mastery"

    def test_double_init_is_idempotent(self):
        """Calling init() twice must not raise and must not duplicate rows."""
        db, _ = make_db()
        db.init()   # second call
        mastery = db.overall_mastery()
        assert mastery == 0, "Second init() must not corrupt state"

    def test_select_returns_known_letter(self):
        db, _ = make_db()
        letter = db.select_next_letter([])
        assert letter in LABELS, f"select_next_letter returned unexpected value: {letter!r}"


# ---------------------------------------------------------------------------
# Box progression tests
# ---------------------------------------------------------------------------

class TestLeitnerBoxProgression:
    """Correct answers advance a letter's box; wrong answers reset it to 1."""

    def test_correct_answer_advances_box(self):
        db, db_path = make_db()
        # Record a correct answer for 'A' and verify mastery increases
        db.update("A", correct=True)
        mastery = db.overall_mastery()
        assert mastery > 0, "Mastery should increase after a correct answer"

    def test_wrong_answer_resets_to_box_1(self):
        db, _ = make_db()
        # Advance 'A' to box 3 first
        db.update("A", correct=True)   # box 1 → 2
        db.update("A", correct=True)   # box 2 → 3
        # Now a wrong answer should reset it
        db.update("A", correct=False)  # should go back to box 1
        # After reset, mastery for 'A' should be 0 again (box 1)
        # Overall mastery contribution from 'A' = (1-1)/4 = 0
        # We can't inspect box directly, but mastery < after-two-correct
        mastery_after_reset = db.overall_mastery()
        assert mastery_after_reset == 0, "Mastery should return to 0 after wrong answer resets box"

    def test_max_box_is_5(self):
        """A letter should not advance past box 5 regardless of correct answers."""
        db, _ = make_db()
        for _ in range(10):   # 10 correct answers — should cap at box 5
            db.update("B", correct=True)
        # Mastery contribution of a single letter at box 5 = (5-1)/(4*24) ≈ 4%
        mastery = db.overall_mastery()
        # If box were uncapped at e.g. 11, mastery would be higher
        # The maximum single-letter contribution is (4)/(4*24) ≈ 4%
        assert 0 < mastery <= 5, f"Unexpected mastery {mastery} — box cap may be broken"


# ---------------------------------------------------------------------------
# Overall mastery tests
# ---------------------------------------------------------------------------

class TestOverallMastery:
    """Mastery percentage calculation should be bounded and monotone."""

    def test_full_mastery_when_all_at_box_5(self):
        """Mastery should reach 100 % when all letters are at box 5."""
        db, _ = make_db()
        # Advance every letter to box 5 (4 correct answers each)
        for ltr in LABELS:
            for _ in range(4):
                db.update(ltr, correct=True)
        mastery = db.overall_mastery()
        assert mastery == 100, f"Expected 100% mastery with all letters at box 5, got {mastery}"

    def test_mastery_increases_monotonically(self):
        db, _ = make_db()
        previous = 0
        for ltr in LABELS[:6]:   # check first 6 letters
            db.update(ltr, correct=True)
            current = db.overall_mastery()
            assert current >= previous, "Mastery should never decrease after a correct answer"
            previous = current


# ---------------------------------------------------------------------------
# Recent-letter avoidance test
# ---------------------------------------------------------------------------

class TestSelectNextLetter:
    """select_next_letter should respect the recent-letter buffer."""

    def test_avoids_recent_letters_if_alternatives_exist(self):
        db, _ = make_db()
        # Provide every letter except 'A' as recent — 'A' should be chosen
        recent = [l for l in LABELS if l != "A"]
        result = db.select_next_letter(recent)
        # With all but 'A' in recent, 'A' should be the only valid choice
        assert result == "A", f"Expected 'A' when all others are recent, got {result!r}"

    def test_falls_back_gracefully_when_all_recent(self):
        """When every label is in recent, the fallback must still return a valid label."""
        db, _ = make_db()
        result = db.select_next_letter(LABELS)   # all letters are "recent"
        assert result in LABELS, "Fallback should still return a valid label"
