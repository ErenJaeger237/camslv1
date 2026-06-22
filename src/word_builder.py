"""
word_builder.py — Stability-based letter commit logic.

Rules:
  1. A letter is committed only when the SAME prediction fills the entire
     rolling buffer (STABILITY_FRAMES consecutive identical predictions).
  2. The same letter cannot be committed twice in a row — the hand must
     show a different sign (or disappear) before it can repeat.
  3. SPACE_FRAMES consecutive frames with no hand detected commit a space
     and reset the repeat-guard so the next letter can commit freely.
"""

from collections import deque

# ---------------------------------------------------------------------------
# Tunable constants
# ---------------------------------------------------------------------------
STABILITY_FRAMES = 15   # frames needed to commit a letter (~0.5 s at 30 fps)
SPACE_FRAMES     = 20   # consecutive no-hand frames to commit a space


class WordBuilder:
    """
    Accumulates per-frame predictions and emits committed characters.

    Typical usage (called once per webcam frame):
        committed = builder.update(letter, confidence)
        if committed:
            print("Committed:", committed)
    """

    def __init__(
        self,
        stability_frames: int = STABILITY_FRAMES,
        space_frames: int = SPACE_FRAMES,
    ):
        self._stab         = stability_frames
        self._space_frames = space_frames
        self._buffer       = deque(maxlen=stability_frames)
        self._no_hand_count    = 0
        self._last_committed   = None   # blocks re-commit of same letter

        self.current_word  = ""   # letters typed since last space
        self.current_text  = ""   # completed words (with trailing spaces)

    # ------------------------------------------------------------------
    # Main update — call once per frame
    # ------------------------------------------------------------------

    def update(self, letter, confidence: float = 1.0):
        """
        Feed the latest prediction.

        Parameters
        ----------
        letter : str or None
            The predicted letter, or None when no hand is detected.
        confidence : float
            Ignored here (threshold filtering is done in recognizer.py),
            kept for API clarity.

        Returns
        -------
        str or None
            The newly committed character (' ' for space, a letter, or None).
        """
        if letter is None:
            return self._handle_no_hand()
        return self._handle_letter(letter)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _handle_no_hand(self):
        self._buffer.clear()
        self._no_hand_count += 1

        if self._no_hand_count >= self._space_frames:
            self._no_hand_count  = 0
            self._last_committed = None   # allow any letter after a gap
            return self._commit(' ')

        return None

    def _handle_letter(self, letter: str):
        self._no_hand_count = 0
        self._buffer.append(letter)

        # Not enough frames yet
        if len(self._buffer) < self._stab:
            return None

        # All frames in buffer must agree
        if len(set(self._buffer)) != 1:
            return None

        # Prevent immediate repeat of the same letter
        if letter == self._last_committed:
            return None

        self._last_committed = letter
        self._buffer.clear()   # reset so the next letter starts fresh
        return self._commit(letter)

    def _commit(self, char: str):
        if char == ' ':
            if self.current_word:
                self.current_text += self.current_word + ' '
                self.current_word  = ""
            return ' '

        self.current_word += char
        return char

    # ------------------------------------------------------------------
    # GUI helpers
    # ------------------------------------------------------------------

    def backspace(self) -> None:
        """Remove the last committed character."""
        if self.current_word:
            self.current_word = self.current_word[:-1]
        elif self.current_text:
            # Move the last completed word back into current_word for editing
            text = self.current_text.rstrip(' ')
            if ' ' in text:
                idx = text.rfind(' ')
                self.current_text  = text[: idx + 1]
                self.current_word  = text[idx + 1 :]
            else:
                self.current_word  = text
                self.current_text  = ""

    def clear(self) -> None:
        """Reset everything."""
        self.current_word    = ""
        self.current_text    = ""
        self._buffer.clear()
        self._last_committed = None
        self._no_hand_count  = 0

    def accept_autocomplete(self, word: str) -> None:
        """Replace the in-progress word with an autocomplete suggestion."""
        self.current_word    = word
        self._last_committed = None   # allow any letter to follow immediately

    @property
    def buffer_fill(self) -> float:
        """0.0–1.0: fraction of the stability window filled (commit progress)."""
        return len(self._buffer) / self._stab if self._stab > 0 else 0.0

    @property
    def full_text(self) -> str:
        """Complete text including the word currently being signed."""
        return self.current_text + self.current_word
