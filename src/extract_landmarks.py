"""
extract_landmarks.py — Step 1 of the pipeline.

Reads the ASL alphabet image dataset (one sub-folder per letter),
runs MediaPipe Hand Landmarker on each image, normalises the 63
landmark coordinates, and writes a single features.csv ready for
training.

Expected dataset layout:
    data/raw/<LETTER>/<image_files>   e.g. data/raw/A/001.jpg

Output:
    data/features.csv   — 63 feature columns + 'label' column

Run:
    python src/extract_landmarks.py
"""

import csv
import urllib.request
from pathlib import Path

import cv2
import kagglehub
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

# ---------------------------------------------------------------------------
# Paths — all relative to the project root (camsl-translator/)
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_RAW     = PROJECT_ROOT / "data" / "raw"
OUTPUT_CSV   = PROJECT_ROOT / "data" / "features.csv"
MODEL_PATH   = PROJECT_ROOT / "models" / "hand_landmarker.task"

# MediaPipe model download URL (official Google storage)
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/"
    "hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
)

# Letters in scope — J and Z excluded (motion-based)
VALID_LABELS = set("ABCDEFGHIKLMNOPQRSTUVWXY")

NUM_LANDMARKS = 21
COORDS_PER_LANDMARK = 3          # x, y, z
NUM_FEATURES = NUM_LANDMARKS * COORDS_PER_LANDMARK   # 63

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def download_model(dest: Path) -> None:
    """Download the MediaPipe hand landmarker model if not already present."""
    if dest.exists():
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading hand landmarker model -> {dest}")
    urllib.request.urlretrieve(MODEL_URL, dest)
    print("Download complete.")


def build_landmarker(model_path: Path) -> mp_vision.HandLandmarker:
    """Instantiate a MediaPipe HandLandmarker in IMAGE mode."""
    base_opts = mp_python.BaseOptions(model_asset_path=str(model_path))
    opts = mp_vision.HandLandmarkerOptions(
        base_options=base_opts,
        running_mode=mp_vision.RunningMode.IMAGE,
        num_hands=1,
        min_hand_detection_confidence=0.3,   # lower threshold for dataset images
        min_hand_presence_confidence=0.3,
        min_tracking_confidence=0.3,
    )
    return mp_vision.HandLandmarker.create_from_options(opts)


def normalise(landmarks: list) -> np.ndarray:
    """
    Translate landmarks so the wrist (landmark 0) is the origin, then
    scale by the distance from wrist to middle-finger MCP (landmark 9).
    This makes features invariant to hand position and distance from camera.
    """
    coords = np.array([[lm.x, lm.y, lm.z] for lm in landmarks])  # (21, 3)

    # Translate: wrist becomes origin
    coords -= coords[0]

    # Scale: use wrist-to-middle-MCP distance as the hand size reference
    scale = np.linalg.norm(coords[9])
    if scale > 0:
        coords /= scale

    return coords.flatten()   # (63,)


def extract_from_image(
    image_path: Path,
    landmarker: mp_vision.HandLandmarker,
) -> np.ndarray | None:
    """
    Run MediaPipe on one image file.
    Returns a normalised (63,) feature vector, or None if no hand detected.
    """
    bgr = cv2.imread(str(image_path))
    if bgr is None:
        return None

    # MediaPipe expects RGB
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

    result = landmarker.detect(mp_image)
    if not result.hand_landmarks:
        return None

    return normalise(result.hand_landmarks[0])


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def resolve_dataset_root() -> Path:
    """
    Return the path to the folder that contains one sub-folder per letter.
    If data/raw/ already has letter sub-folders, use it directly.
    Otherwise download via kagglehub and locate the training split.
    """
    # Check if the user already placed the data manually
    if DATA_RAW.exists():
        letter_dirs = [d for d in DATA_RAW.iterdir() if d.is_dir() and d.name.upper() in VALID_LABELS]
        if letter_dirs:
            print(f"Using existing dataset at {DATA_RAW}")
            return DATA_RAW

    # Auto-download from Kaggle (requires kaggle credentials in ~/.kaggle/kaggle.json)
    print("Dataset not found locally — downloading from Kaggle via kagglehub...")
    print("(This will take a few minutes on first run; cached afterwards.)\n")
    kaggle_root = Path(kagglehub.dataset_download("grassknoted/asl-alphabet"))
    print(f"Kaggle dataset cached at: {kaggle_root}\n")

    # The dataset contains asl_alphabet_train/ and asl_alphabet_test/
    # The training folder has one sub-folder per letter.
    for candidate in [
        kaggle_root / "asl_alphabet_train" / "asl_alphabet_train",
        kaggle_root / "asl_alphabet_train",
        kaggle_root,
    ]:
        if candidate.exists():
            dirs = [d for d in candidate.iterdir() if d.is_dir() and d.name.upper() in VALID_LABELS]
            if dirs:
                print(f"Using training split: {candidate}")
                return candidate

    raise RuntimeError(
        f"Could not locate letter sub-folders inside the downloaded dataset at {kaggle_root}.\n"
        "Please check the dataset layout and set DATA_RAW manually."
    )


def main() -> None:
    dataset_root = resolve_dataset_root()

    download_model(MODEL_PATH)
    landmarker = build_landmarker(MODEL_PATH)

    # Column header: feature_0 … feature_62, label
    header = [f"feature_{i}" for i in range(NUM_FEATURES)] + ["label"]

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)

    processed = skipped = 0

    with open(OUTPUT_CSV, "w", newline="") as fout:
        writer = csv.writer(fout)
        writer.writerow(header)

        # Iterate over each letter folder in alphabetical order
        letter_dirs = sorted(
            d for d in dataset_root.iterdir()
            if d.is_dir() and d.name.upper() in VALID_LABELS
        )

        if not letter_dirs:
            raise RuntimeError(
                f"No valid letter sub-folders found in {dataset_root}.\n"
                f"Expected folders named A-Y (excluding J and Z)."
            )

        for letter_dir in letter_dirs:
            label = letter_dir.name.upper()
            image_files = [
                p for p in letter_dir.iterdir()
                if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp"}
            ]

            if not image_files:
                print(f"  [{label}] no images found — skipping folder")
                continue

            label_ok = label_skip = 0
            for img_path in image_files:
                features = extract_from_image(img_path, landmarker)
                if features is None:
                    label_skip += 1
                    skipped += 1
                    continue
                writer.writerow(list(features) + [label])
                label_ok += 1
                processed += 1

            print(f"  [{label}] {label_ok} saved, {label_skip} skipped (no hand detected)")

    landmarker.close()

    print(f"\nDone. {processed} samples saved to {OUTPUT_CSV}")
    print(f"Skipped {skipped} images where MediaPipe detected no hand.")
    if processed == 0:
        print("WARNING: features.csv is empty. Check your dataset layout.")


if __name__ == "__main__":
    main()
