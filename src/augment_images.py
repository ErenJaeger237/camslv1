"""
augment_images.py — Image-level data augmentation for the ASL landmark dataset.

Why image-level rather than feature-level?
  Feature noise (train.py) simulates hand tremor but every augmented sample
  goes through the same MediaPipe path. Image augmentation changes lighting,
  contrast, angle, and zoom BEFORE MediaPipe runs — so the model learns to
  handle the real variation that MediaPipe itself produces under different
  conditions (bright room, dim room, close hand, far hand, slight tilt).

What this script does:
  1. Reads each image in the dataset.
  2. Creates AUG_PER_IMAGE augmented copies using random transforms.
  3. Runs MediaPipe on each copy.
  4. Appends successful detections to data/features.csv (non-destructive).

Run AFTER extract_landmarks.py (features.csv must exist):
    python src/augment_images.py

Then retrain:
    python src/train.py
"""

import csv
import random
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATASET_ROOT = (
    Path.home()
    / ".cache/kagglehub/datasets/grassknoted/asl-alphabet/versions/1"
    / "asl_alphabet_train/asl_alphabet_train"
)
FEATURES_CSV = PROJECT_ROOT / "data" / "features.csv"
MODEL_PATH   = PROJECT_ROOT / "models" / "hand_landmarker.task"

# ---------------------------------------------------------------------------
# Augmentation config
# ---------------------------------------------------------------------------
AUG_PER_IMAGE     = 3        # augmented copies per original image
VALID_LABELS      = set("ABCDEFGHIKLMNOPQRSTUVWXY")

# Transform ranges
BRIGHTNESS_RANGE  = (0.55, 1.45)   # multiply all pixels by this factor
CONTRAST_RANGE    = (0.65, 1.35)   # contrast scale around mean
ROTATION_RANGE    = (-18, 18)      # degrees
ZOOM_RANGE        = (0.80, 1.20)   # scale factor (>1 = zoom in, <1 = zoom out)
BLUR_PROB         = 0.35           # probability of applying slight blur

NUM_LANDMARKS  = 21
NUM_FEATURES   = NUM_LANDMARKS * 3


# ---------------------------------------------------------------------------
# Augmentation helpers
# ---------------------------------------------------------------------------

def augment_image(img: np.ndarray) -> np.ndarray:
    """Apply a random combination of transforms to one BGR image."""
    h, w = img.shape[:2]
    out = img.astype(np.float32)

    # Brightness
    factor = random.uniform(*BRIGHTNESS_RANGE)
    out = np.clip(out * factor, 0, 255)

    # Contrast: scale around the mean
    factor = random.uniform(*CONTRAST_RANGE)
    mean = out.mean()
    out = np.clip((out - mean) * factor + mean, 0, 255)

    out = out.astype(np.uint8)

    # Rotation
    angle = random.uniform(*ROTATION_RANGE)
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    out = cv2.warpAffine(out, M, (w, h), borderMode=cv2.BORDER_REFLECT)

    # Zoom (crop centre then resize back)
    zoom = random.uniform(*ZOOM_RANGE)
    if zoom > 1.0:
        # Zoom in: crop then resize
        crop = int(min(h, w) / zoom)
        cy, cx = h // 2, w // 2
        y1, y2 = max(0, cy - crop // 2), min(h, cy + crop // 2)
        x1, x2 = max(0, cx - crop // 2), min(w, cx + crop // 2)
        out = cv2.resize(out[y1:y2, x1:x2], (w, h))
    else:
        # Zoom out: shrink and pad
        new_h, new_w = int(h * zoom), int(w * zoom)
        small = cv2.resize(out, (new_w, new_h))
        canvas = np.zeros_like(out)
        py = (h - new_h) // 2
        px = (w - new_w) // 2
        canvas[py:py + new_h, px:px + new_w] = small
        out = canvas

    # Blur
    if random.random() < BLUR_PROB:
        k = random.choice([3, 5])
        out = cv2.GaussianBlur(out, (k, k), 0)

    return out


# ---------------------------------------------------------------------------
# MediaPipe helpers
# ---------------------------------------------------------------------------

def build_landmarker():
    base = mp_python.BaseOptions(model_asset_path=str(MODEL_PATH))
    opts = mp_vision.HandLandmarkerOptions(
        base_options=base,
        running_mode=mp_vision.RunningMode.IMAGE,
        num_hands=1,
        min_hand_detection_confidence=0.4,
        min_hand_presence_confidence=0.4,
        min_tracking_confidence=0.4,
    )
    return mp_vision.HandLandmarker.create_from_options(opts)


def normalise(landmarks) -> np.ndarray:
    """Identical to extract_landmarks.py — must stay in sync."""
    coords = np.array([[lm.x, lm.y, lm.z] for lm in landmarks])
    coords -= coords[0]
    scale = np.linalg.norm(coords[9])
    if scale > 0:
        coords /= scale
    return coords.flatten()


def extract(img_bgr: np.ndarray, landmarker) -> np.ndarray | None:
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = landmarker.detect(mp_img)
    if not result.hand_landmarks:
        return None
    return normalise(result.hand_landmarks[0])


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if not FEATURES_CSV.exists():
        raise FileNotFoundError(
            "features.csv not found. Run extract_landmarks.py first."
        )
    if not DATASET_ROOT.exists():
        raise FileNotFoundError(
            f"Dataset not found at {DATASET_ROOT}.\n"
            "Run extract_landmarks.py first to download it."
        )

    landmarker = build_landmarker()
    total_added = total_skip = 0

    # Append to existing CSV (features.csv already has a header row)
    with open(FEATURES_CSV, "a", newline="") as fout:
        writer = csv.writer(fout)

        letter_dirs = sorted(
            d for d in DATASET_ROOT.iterdir()
            if d.is_dir() and d.name.upper() in VALID_LABELS
        )

        for letter_dir in letter_dirs:
            label = letter_dir.name.upper()
            images = [
                p for p in letter_dir.iterdir()
                if p.suffix.lower() in {".jpg", ".jpeg", ".png"}
            ]

            if not images:
                continue

            added = skipped = 0
            for img_path in images:
                bgr = cv2.imread(str(img_path))
                if bgr is None:
                    continue

                for _ in range(AUG_PER_IMAGE):
                    aug = augment_image(bgr)
                    features = extract(aug, landmarker)
                    if features is None:
                        skipped += 1
                        total_skip += 1
                    else:
                        writer.writerow(list(features) + [label])
                        added += 1
                        total_added += 1

            print(f"  [{label}] +{added} augmented samples  ({skipped} skipped)")

    landmarker.close()
    print(f"\nDone. Added {total_added:,} augmented samples to {FEATURES_CSV}")
    print(f"Skipped {total_skip:,} (no hand detected in augmented image)")
    print("Run  python src/train.py  to retrain on the expanded dataset.")


if __name__ == "__main__":
    main()
