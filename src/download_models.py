"""
download_models.py — Download optional MediaPipe task models.

The HandLandmarker model (hand_landmarker.task) ships with MediaPipe.
The FaceLandmarker and PoseLandmarker models are hosted separately and are
needed for the holistic feature extractor (face + pose + hand = 150 features).

Run once before using word-sign mode with the enhanced extractor:
    python src/download_models.py
"""

import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR   = PROJECT_ROOT / "models"

MODELS = {
    "face_landmarker.task": (
        "https://storage.googleapis.com/mediapipe-models/"
        "face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
    ),
    "pose_landmarker_lite.task": (
        "https://storage.googleapis.com/mediapipe-models/"
        "pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
    ),
}


def _progress(block_num, block_size, total_size):
    pct = min(block_num * block_size / total_size * 100, 100)
    filled = int(pct / 4)
    bar = "#" * filled + "-" * (25 - filled)
    print(f"\r  [{bar}] {pct:5.1f}%", end="", flush=True)


def download_all(force: bool = False) -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    for name, url in MODELS.items():
        dest = MODELS_DIR / name
        if dest.exists() and not force:
            print(f"  {name}  already exists — skipping.")
            continue
        print(f"\nDownloading  {name} ...")
        urllib.request.urlretrieve(url, dest, _progress)
        kb = dest.stat().st_size / 1024
        print(f"\n  Saved  {dest}  ({kb:.0f} KB)")
    print("\nAll models ready.")


if __name__ == "__main__":
    import sys
    force = "--force" in sys.argv
    download_all(force=force)
