"""
tests/test_word_builder.py

Unit tests for the WordBuilder stability-commit logic.
These test pure Python logic — no webcam, no MediaPipe, no Keras required.

Run:
    pytest tests/test_word_builder.py -v
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from word_builder import STABILITY_FRAMES, SPACE_FRAMES, WordBuilder


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def feed(builder: WordBuilder, letter: str | None, n: int) -> None:
    """Push `n` consecutive frames of the same letter into the builder."""
    for _ in range(n):
        builder.update(letter)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestWordBuilderCommit:
    """Letters should commit only after sustained stable prediction."""

    def test_single_letter_commits_after_stability(self):
        wb = WordBuilder()
        feed(wb, "A", STABILITY_FRAMES)
        assert wb.current_word == "A", "Letter should commit after STABILITY_FRAMES frames"

    def test_one_less_frame_does_not_commit(self):
        wb = WordBuilder()
        feed(wb, "A", STABILITY_FRAMES - 1)
        assert wb.current_word == "", "One frame short of stability must not commit"

    def test_same_letter_does_not_repeat_without_gap(self):
        wb = WordBuilder()
        feed(wb, "A", STABILITY_FRAMES)     # first commit
        assert wb.current_word == "A"
        feed(wb, "A", STABILITY_FRAMES * 2) # same letter, no gap
        # Must still be exactly one "A" — no duplicate
        assert wb.current_word == "A"

    def test_different_letter_commits_after_first(self):
        wb = WordBuilder()
        feed(wb, "H", STABILITY_FRAMES)
        feed(wb, "I", STABILITY_FRAMES)
        assert wb.current_word == "HI"

    def test_no_hand_for_space_frames_commits_space(self):
        wb = WordBuilder()
        feed(wb, "H", STABILITY_FRAMES)
        feed(wb, "I", STABILITY_FRAMES)
        feed(wb, None, SPACE_FRAMES)        # open palm / no hand
        # Word should have moved to current_text and current_word reset
        assert "HI" in wb.current_text
        assert wb.current_word == ""

    def test_clear_resets_all_state(self):
        wb = WordBuilder()
        feed(wb, "A", STABILITY_FRAMES)
        wb.clear()
        assert wb.current_word == ""
        assert wb.current_text == ""

    def test_mixed_buffer_does_not_commit(self):
        """Interleaved predictions must not commit any letter."""
        wb = WordBuilder()
        for i in range(STABILITY_FRAMES):
            wb.update("A" if i % 2 == 0 else "B")
        assert wb.current_word == ""


class TestWordBuilderAutocomplete:
    """accept_autocomplete should replace the in-progress word."""

    def test_accept_replaces_partial_word(self):
        wb = WordBuilder()
        feed(wb, "H", STABILITY_FRAMES)
        feed(wb, "E", STABILITY_FRAMES)
        wb.accept_autocomplete("HELLO")
        # accept_autocomplete sets current_word; the display is current_text + current_word
        assert "HELLO" in wb.full_text

    def test_accept_empty_string_is_safe(self):
        wb = WordBuilder()
        wb.accept_autocomplete("")          # must not raise
        assert wb.current_text == ""
