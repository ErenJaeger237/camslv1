"""
copy_sign_images.py — Picks the best representative image per letter
from the downloaded dataset and copies it to assets/signs/<LETTER>.png.

"Best" = first image where MediaPipe detects a hand with high confidence.
Run once; safe to re-run (overwrites existing sign images).

Run:
    python src/copy_sign_images.py
"""

import shutil
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATASET_ROOT = (
    Path.home()
    / ".cache/kagglehub/datasets/grassknoted/asl-alphabet/versions/1"
    / "asl_alphabet_train/asl_alphabet_train"
)
SIGNS_DIR  = PROJECT_ROOT / "assets" / "signs"
MODEL_PATH = PROJECT_ROOT / "models" / "hand_landmarker.task"

VALID_LABELS = set("ABCDEFGHIKLMNOPQRSTUVWXY")
MIN_CONFIDENCE = 0.7   # only pick images where MediaPipe is confident


def build_landmarker():
    base = mp_python.BaseOptions(model_asset_path=str(MODEL_PATH))
    opts = mp_vision.HandLandmarkerOptions(
        base_options=base,
        running_mode=mp_vision.RunningMode.IMAGE,
        num_hands=1,
        min_hand_detection_confidence=MIN_CONFIDENCE,
    )
    return mp_vision.HandLandmarker.create_from_options(opts)


def best_image_for_letter(letter_dir: Path, landmarker) -> Path | None:
    """Return path to the first image where MediaPipe detects a clear hand."""
    images = sorted(letter_dir.glob("*.jpg")) + sorted(letter_dir.glob("*.png"))
    for img_path in images:
        bgr = cv2.imread(str(img_path))
        if bgr is None:
            continue
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = landmarker.detect(mp_img)
        if result.hand_landmarks:
            return img_path
    return None


def main():
    SIGNS_DIR.mkdir(parents=True, exist_ok=True)

    if not DATASET_ROOT.exists():
        raise FileNotFoundError(
            f"Dataset not found at {DATASET_ROOT}\n"
            "Run extract_landmarks.py first to download it."
        )

    landmarker = build_landmarker()
    found = skipped = 0

    for letter in sorted(VALID_LABELS):
        letter_dir = DATASET_ROOT / letter
        if not letter_dir.exists():
            print(f"  [{letter}] folder missing — skipping")
            skipped += 1
            continue

        best = best_image_for_letter(letter_dir, landmarker)
        if best is None:
            print(f"  [{letter}] no suitable image found")
            skipped += 1
            continue

        dest = SIGNS_DIR / f"{letter}.png"
        # Convert to PNG regardless of source format
        img = cv2.imread(str(best))
        cv2.imwrite(str(dest), img)
        print(f"  [{letter}] -> {dest.name}  (source: {best.name})")
        found += 1

    landmarker.close()
    print(f"\nDone. {found} sign images saved to {SIGNS_DIR}, {skipped} skipped.")


if __name__ == "__main__":
    main()
