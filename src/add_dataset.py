"""
add_dataset.py — Download a second ASL dataset and append its landmarks to features.csv.

Uses the synthetic ASL alphabet dataset (lexset/synthetic-asl-alphabet) which
provides diverse hand appearances: different skin tones, backgrounds, and lighting.
Combining it with the grassknoted dataset improves generalisation significantly.

Run after extract_landmarks.py:
    python src/add_dataset.py

Then retrain:
    python src/train.py
"""

import csv
from pathlib import Path

import cv2
import kagglehub
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
FEATURES_CSV = PROJECT_ROOT / "data" / "features.csv"
MODEL_PATH   = PROJECT_ROOT / "models" / "hand_landmarker.task"

VALID_LABELS = set("ABCDEFGHIKLMNOPQRSTUVWXY")
NUM_FEATURES = 21 * 3   # 63

# Label remapping — some datasets use lowercase or "space"/"del" folders
# Map to our uppercase single-letter convention; skip anything not in VALID_LABELS
LABEL_REMAP = {ltr.lower(): ltr for ltr in VALID_LABELS}
LABEL_REMAP.update({ltr: ltr for ltr in VALID_LABELS})   # uppercase pass-through


# ---------------------------------------------------------------------------
# MediaPipe helpers (identical to extract_landmarks.py)
# ---------------------------------------------------------------------------

def build_landmarker():
    base = mp_python.BaseOptions(model_asset_path=str(MODEL_PATH))
    opts = mp_vision.HandLandmarkerOptions(
        base_options=base,
        running_mode=mp_vision.RunningMode.IMAGE,
        num_hands=1,
        min_hand_detection_confidence=0.35,
        min_hand_presence_confidence=0.35,
        min_tracking_confidence=0.35,
    )
    return mp_vision.HandLandmarker.create_from_options(opts)


def normalise(landmarks) -> np.ndarray:
    coords = np.array([[lm.x, lm.y, lm.z] for lm in landmarks])
    coords -= coords[0]
    scale = np.linalg.norm(coords[9])
    if scale > 0:
        coords /= scale
    return coords.flatten()


def extract(img_path: Path, landmarker) -> np.ndarray | None:
    bgr = cv2.imread(str(img_path))
    if bgr is None:
        return None
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    mp_img = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = landmarker.detect(mp_img)
    if not result.hand_landmarks:
        return None
    return normalise(result.hand_landmarks[0])


# ---------------------------------------------------------------------------
# Dataset discovery — finds letter sub-folders wherever they live
# ---------------------------------------------------------------------------

def find_letter_dirs(root: Path) -> dict[str, Path]:
    """
    Walk `root` looking for folders whose name maps to a valid letter.
    Returns {LETTER: folder_path}.
    """
    found = {}
    for folder in root.rglob("*"):
        if not folder.is_dir():
            continue
        mapped = LABEL_REMAP.get(folder.name)
        if mapped and mapped not in found:
            # Make sure it actually contains images
            if any(folder.glob("*.jpg")) or any(folder.glob("*.png")):
                found[mapped] = folder
    return found


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if not FEATURES_CSV.exists():
        raise FileNotFoundError(
            "features.csv not found. Run extract_landmarks.py first."
        )

    print("Downloading synthetic ASL alphabet dataset from Kaggle...")
    kaggle_root = Path(kagglehub.dataset_download("lexset/synthetic-asl-alphabet"))
    print(f"Cached at: {kaggle_root}\n")

    letter_dirs = find_letter_dirs(kaggle_root)
    if not letter_dirs:
        raise RuntimeError(
            f"No letter sub-folders found in {kaggle_root}.\n"
            "The dataset layout may have changed — inspect the folder manually."
        )

    print(f"Found {len(letter_dirs)} letter folders.\n")
    landmarker = build_landmarker()
    total_added = total_skip = 0

    with open(FEATURES_CSV, "a", newline="") as fout:
        writer = csv.writer(fout)

        for label in sorted(letter_dirs):
            folder = letter_dirs[label]
            images = [
                p for p in folder.iterdir()
                if p.suffix.lower() in {".jpg", ".jpeg", ".png"}
            ]
            added = skipped = 0
            for img_path in images:
                features = extract(img_path, landmarker)
                if features is None:
                    skipped += 1
                    total_skip += 1
                else:
                    writer.writerow(list(features) + [label])
                    added += 1
                    total_added += 1

            print(f"  [{label}] +{added} samples  ({skipped} skipped)")

    landmarker.close()
    print(f"\nDone. Added {total_added:,} samples from synthetic dataset.")
    print(f"Skipped {total_skip:,} images (no hand detected).")
    print("Run  python src/train.py  to retrain on the expanded dataset.")


if __name__ == "__main__":
    main()
