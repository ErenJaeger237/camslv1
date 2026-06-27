"""
tests/test_autocomplete.py

Unit tests for the autocomplete suggest() function.
No webcam, no MediaPipe, no Keras required.

Run:
    pytest tests/test_autocomplete.py -v
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from autocomplete import MAX_SUGGESTIONS, MIN_PREFIX_LEN, suggest


class TestSuggestBasicBehaviour:
    """Core filtering and return-type checks."""

    def test_returns_list(self):
        result = suggest("HE")
        assert isinstance(result, list), "suggest() must return a list"

    def test_returns_empty_for_short_prefix(self):
        """Prefixes shorter than MIN_PREFIX_LEN must return no suggestions."""
        result = suggest("H")
        assert result == [], f"Expected [] for 1-char prefix, got {result}"

    def test_returns_empty_for_empty_string(self):
        result = suggest("")
        assert result == []

    def test_case_insensitive_input(self):
        """Lower-case and upper-case prefix should yield the same results."""
        lower = suggest("he")
        upper = suggest("HE")
        assert lower == upper, "suggest() must be case-insensitive"

    def test_results_are_uppercase(self):
        results = suggest("GO")
        assert all(w == w.upper() for w in results), "All results must be uppercase"

    def test_all_results_start_with_prefix(self):
        prefix = "WA"
        results = suggest(prefix)
        for w in results:
            assert w.startswith(prefix.upper()), f"{w!r} does not start with {prefix!r}"

    def test_max_suggestions_cap(self):
        """Never return more than MAX_SUGGESTIONS words."""
        # 'S' prefix should match many words
        results = suggest("S", max_results=MAX_SUGGESTIONS)
        assert len(results) <= MAX_SUGGESTIONS, (
            f"Expected at most {MAX_SUGGESTIONS} results, got {len(results)}"
        )


class TestSuggestKnownWords:
    """Specific vocabulary checks against the curated word list."""

    def test_hello_from_he(self):
        results = suggest("HE")
        assert "HELLO" in results, "'HELLO' should appear for prefix 'HE'"

    def test_please_from_pl(self):
        results = suggest("PL")
        assert "PLEASE" in results, "'PLEASE' should appear for prefix 'PL'"

    def test_goodbye_from_go(self):
        results = suggest("GO")
        assert "GOODBYE" in results, "'GOODBYE' should appear for prefix 'GO'"

    def test_no_match_for_unknown_prefix(self):
        results = suggest("ZZ")
        assert results == [], f"Expected [] for unknown prefix 'ZZ', got {results}"

    def test_custom_max_results_respected(self):
        results = suggest("S", max_results=2)
        assert len(results) <= 2, "Custom max_results=2 must be respected"


class TestSuggestEdgeCases:
    """Edge cases that should not raise exceptions."""

    def test_whitespace_prefix_returns_empty(self):
        result = suggest("  ")   # only spaces — stripped length < MIN_PREFIX_LEN
        assert result == [], f"Expected [] for whitespace prefix, got {result}"

    def test_min_prefix_len_boundary(self):
        """Exactly MIN_PREFIX_LEN characters should not return empty (unless no match)."""
        # 'HE' is MIN_PREFIX_LEN chars and should find 'HELLO'
        result = suggest("HE")
        assert isinstance(result, list)
        assert len(result) >= 1, "Exact MIN_PREFIX_LEN prefix should produce results if a match exists"
