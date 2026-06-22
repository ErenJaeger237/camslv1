"""
text_to_sign.py — Maps text to sign images for the Text -> Sign direction.

Given a string, returns an ordered list of image paths:
  - Each letter maps to  assets/signs/<LETTER>.png
  - Known whole-word signs map to  assets/signs/<WORD>.png  (takes priority)
  - Spaces and unknown characters are skipped.

The GUI displays these images in sequence so the user can see how to sign
each letter or word.
"""

from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SIGNS_DIR    = PROJECT_ROOT / "assets" / "signs"

# Words that have a dedicated whole-sign image (common signs from §4.5).
# If the image file exists, the whole word is shown as one sign instead of
# spelling it letter by letter.
WHOLE_WORD_SIGNS = {
    "HELLO", "GOODBYE", "THANKYOU", "THANK", "YES", "NO", "PLEASE",
    "HELP", "SORRY", "NAME", "EAT", "DRINK", "WATER", "GOOD", "BAD",
    "SICK", "HOSPITAL", "SCHOOL", "FRIEND", "OKAY", "MORE", "STOP",
}


def text_to_image_paths(text: str) -> list[Path]:
    """
    Convert a string into an ordered list of sign image paths.

    Whole-word signs take priority over letter-by-letter spelling.
    Missing image files are silently skipped (image may not be in assets yet).

    Parameters
    ----------
    text : str
        The text to convert (e.g. "HELLO WORLD").

    Returns
    -------
    list[Path]
        Ordered list of existing image paths to display.
    """
    paths: list[Path] = []

    for token in text.upper().split():
        # Check for a whole-word sign image first
        if token in WHOLE_WORD_SIGNS:
            img = SIGNS_DIR / f"{token}.png"
            if img.exists():
                paths.append(img)
                continue
            # Fall through to letter-by-letter if image is missing

        # Spell the token letter by letter
        for char in token:
            if not char.isalpha():
                continue
            img = SIGNS_DIR / f"{char}.png"
            if img.exists():
                paths.append(img)

    return paths


def available_signs() -> list[str]:
    """Return the names of all sign images currently in assets/signs/."""
    return sorted(p.stem for p in SIGNS_DIR.glob("*.png"))
