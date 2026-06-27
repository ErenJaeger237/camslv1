"""
extract_word_landmarks.py -- Convert ASL sign videos into MediaPipe landmark sequences.

Place your videos as:
    data/raw_videos/<sign_name>/<any_filename>.mp4   (or .avi / .mov)

Output saved to:
    data/signs/<sign_name>/sample_NNN.npy   shape: (30, 150) float32

Each video produces ONE sample of 30 evenly-spaced holistic feature vectors
(hand 63 + face 60 + pose 27 = 150 features, matching train_signs.py).
Videos where hand is absent in >40% of sampled frames are silently discarded.

Usage
-----
    python src/extract_word_landmarks.py                    # default: data/raw_videos/
    python src/extract_word_landmarks.py --video-dir PATH   # custom directory
    python src/extract_word_landmarks.py --dry-run          # count videos only, no writing
"""

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from landmarks import HolisticExtractor, NUM_HOLISTIC_FEATURES

# Tunables
SEQUENCE_FRAMES   = 30      # must match record_signs.py / train_signs.py
MIN_HAND_RATIO    = 0.40    # discard video if hand present in fewer than this fraction
VIDEO_EXTS        = {".mp4", ".avi", ".mov", ".webm", ".mkv"}

PROJECT_ROOT      = Path(__file__).resolve().parent.parent
DEFAULT_VIDEO_DIR = PROJECT_ROOT / "data" / "raw_videos"
SIGNS_OUT_DIR     = PROJECT_ROOT / "data" / "signs"

TARGET_SIGNS = [
    "hello", "thank_you", "yes", "no", "please",
    "help", "sorry", "goodbye", "sick",
    "eat", "drink", "school", "good", "bad", "friend",
]


def existing_sample_count(sign_out_dir: Path) -> int:
    return len(list(sign_out_dir.glob("sample_*.npy"))) if sign_out_dir.exists() else 0


def extract_sequence(video_path: Path, extractor: HolisticExtractor) -> np.ndarray:
    """
    Read every frame of a video sequentially, run HolisticExtractor on each,
    then return SEQUENCE_FRAMES evenly-spaced feature vectors as a (30, 150) array.

    Returns None if the video cannot be opened, is too short, or has too few
    frames with a detected hand.

    HolisticExtractor uses MediaPipe VIDEO mode which requires monotonically
    increasing timestamps. Seeking breaks the tracker. Reading sequentially
    keeps timestamps consistent and allows the tracker to interpolate smoothly.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return None

    all_features = []

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        features, _, _ = extractor.process(frame)
        vec = features if features is not None else np.zeros(NUM_HOLISTIC_FEATURES, dtype=np.float32)
        all_features.append(vec)

    cap.release()

    if len(all_features) < SEQUENCE_FRAMES:
        return None

    indices = np.linspace(0, len(all_features) - 1, SEQUENCE_FRAMES, dtype=int)
    seq = np.array([all_features[i] for i in indices], dtype=np.float32)  # (30, 150)

    hand_present = np.any(seq[:, :63] != 0, axis=1).mean()
    if hand_present < MIN_HAND_RATIO:
        return None

    return seq


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert sign videos to landmark .npy samples.")
    parser.add_argument("--video-dir", default=str(DEFAULT_VIDEO_DIR),
                        help="Root folder containing <sign_name>/ subfolders of videos")
    parser.add_argument("--dry-run", action="store_true",
                        help="List videos found without extracting anything")
    args = parser.parse_args()

    video_root = Path(args.video_dir)
    if not video_root.exists():
        print(f"\nERROR: video directory not found:\n  {video_root}")
        print("\nCreate it and add sign subfolders:")
        print("  data/raw_videos/hello/video1.mp4")
        print("  data/raw_videos/yes/clip1.mp4  ...")
        sys.exit(1)

    sign_dirs = sorted(d for d in video_root.iterdir() if d.is_dir())
    if not sign_dirs:
        print(f"No subfolders found in {video_root}.")
        print("Expected structure:  data/raw_videos/<sign_name>/<video>.mp4")
        sys.exit(1)

    print(f"\n{'Sign':<14} {'Videos':>7}  {'Already saved':>13}")
    print("-" * 40)
    total_videos = 0
    for sd in sign_dirs:
        vids = [f for f in sd.iterdir() if f.suffix.lower() in VIDEO_EXTS]
        saved = existing_sample_count(SIGNS_OUT_DIR / sd.name)
        print(f"  {sd.name:<12}  {len(vids):>5}    {saved:>10}")
        total_videos += len(vids)
    print(f"\n  Total: {total_videos} videos across {len(sign_dirs)} signs")

    if args.dry_run:
        return

    if total_videos == 0:
        print("\nNo video files found. Check file extensions (.mp4 .avi .mov .webm .mkv).")
        sys.exit(1)

    print("\nStarting extraction - this may take several minutes ...\n")

    extractor = HolisticExtractor()

    grand_saved = 0
    grand_skipped = 0

    for sd in sign_dirs:
        sign = sd.name
        out_dir = SIGNS_OUT_DIR / sign
        out_dir.mkdir(parents=True, exist_ok=True)

        videos = sorted(f for f in sd.iterdir() if f.suffix.lower() in VIDEO_EXTS)
        if not videos:
            continue

        sign_saved = 0
        sign_skipped = 0

        for vp in videos:
            try:
                seq = extract_sequence(vp, extractor)
            except Exception as e:
                print(f"    [!] {vp.name}: {e}")
                sign_skipped += 1
                continue

            if seq is None:
                sign_skipped += 1
                continue

            n = existing_sample_count(out_dir) + sign_saved
            np.save(out_dir / f"sample_{n:03d}.npy", seq)
            sign_saved += 1

        total_now = existing_sample_count(out_dir)
        status = "ready" if total_now >= 15 else f"need {max(0, 15 - total_now)} more"
        print(f"  {sign:<14} saved {sign_saved:>3}  skipped {sign_skipped:>3}  "
              f"total {total_now:>3}  [{status}]")

        grand_saved += sign_saved
        grand_skipped += sign_skipped

    extractor.close()

    print(f"\n{'-'*50}")
    print(f"  Done.  {grand_saved} samples saved,  {grand_skipped} videos skipped.")
    print(f"  Output: {SIGNS_OUT_DIR}")

    print(f"\n{'-'*50}")
    print("  Final counts for target signs:\n")
    ready = 0
    for s in TARGET_SIGNS:
        n = existing_sample_count(SIGNS_OUT_DIR / s)
        bar = "#" * min(n, 20)
        mark = "OK" if n >= 15 else "--"
        print(f"  {mark} {s:<12} {bar:<20} {n:>3}")
        if n >= 15:
            ready += 1

    print(f"\n  {ready}/{len(TARGET_SIGNS)} signs have >= 15 samples.")
    if ready == len(TARGET_SIGNS):
        print("  All signs ready.  Run:  python src/train_signs.py")
    else:
        print("  Add more videos for signs marked --, then re-run this script.")


if __name__ == "__main__":
    main()
